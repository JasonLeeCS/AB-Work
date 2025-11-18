/**
 * WMS Scheduler Backend API
 * 
 * Express server that connects to Databricks SQL API to execute queries
 * for the WMS Scheduler frontend application.
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const config = require('./config.json');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Databricks SQL API configuration
const DATABRICKS_CONFIG = {
  hostname: config.databricks.hostname,
  httpPath: config.databricks.httpPath,
  token: config.databricks.token,
  // Extract warehouse ID from httpPath (e.g., /sql/1.0/warehouses/fc33eb76ba6ba3aa)
  warehouseId: config.databricks.httpPath.split('/').pop(),
  // SQL API endpoint
  apiUrl: `https://${config.databricks.hostname}/api/2.0/sql/statements`,
};

function sanitizeFutureDays(value) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 7;
  }
  return parsed;
}

function buildQueryComponents(loadType = 'ALL OUTBOUND', productType = 'ALL', futureDays = 7) {
  const normalizedLoadType = (loadType || '').toUpperCase().trim();
  const normalizedProduct = (productType || '').toUpperCase().trim();
  const days = sanitizeFutureDays(futureDays);

  const selectPull = "date_format(vs.pull_tsp, 'HH:mm') AS PULL_TIME, date_format(vs.pull_tsp, 'yyyy-MM-dd') AS PULL_DATE ";
  const selectSchd =
    "CASE WHEN hour(vs.schd_unload_tsp) = 0 THEN '00:01' ELSE date_format(vs.schd_unload_tsp, 'HH:00') END AS SCHD_HR, date_format(vs.schd_unload_tsp, 'yyyy-MM-dd') AS SCHD_DATE ";

  const futuresOutbound = `AND date(vs.pull_tsp) BETWEEN current_date() AND date_add(current_date(), ${days}) AND vs.outbnd_shpmt_stat_cd NOT IN ('110') AND equip.outbnd_tractor_check_in_tsp IS NULL `;
  const dragsOutbound = "AND date(vs.pull_tsp) > date_add(current_date(), -2) AND date(vs.pull_tsp) < current_date() AND vs.outbnd_shpmt_stat_cd NOT IN ('110') AND equip.outbnd_tractor_check_in_tsp IS NULL ";

  const futuresInbound = `AND date(vs.schd_unload_tsp) BETWEEN current_date() AND date_add(current_date(), ${days}) `;
  const dragsInbound = "AND date(vs.pull_tsp) > date_add(current_date(), -2) AND date(vs.pull_tsp) < current_date() ";

  let whereBlockAddendum = '';
  let selectBlockAddendum = selectPull;
  let futures = futuresOutbound;
  let drags = dragsOutbound;

  switch (normalizedLoadType) {
    case 'ALL OUTBOUND':
      whereBlockAddendum = '';
      break;
    case 'LIVE':
      whereBlockAddendum =
        "AND (vs.spotting_serv_id = 'LIVE' OR vs.spotting_serv_id IS NULL) AND bc.carr_seq_id IS NOT NULL AND carr.scac_cd <> 'HOLD' ";
      break;
    case 'DEDICATED':
      whereBlockAddendum =
        "AND bc.ded_flg = 1 AND vs.spotting_serv_id IS NOT NULL AND vs.spotting_serv_id <> 'LIVE' ";
      break;
    case 'ASSET-OTR':
      whereBlockAddendum =
        "AND vs.spotting_serv_id IS NOT NULL AND vs.spotting_serv_id <> 'LIVE' AND (bc.ded_flg = 0 OR bc.ded_flg IS NULL) AND bc.carr_seq_id IS NOT NULL AND carr.scac_cd <> 'HOLD' ";
      break;
    case 'UNCOVERED':
      whereBlockAddendum = "AND (bc.carr_seq_id IS NULL OR carr.scac_cd = 'HOLD') ";
      break;
    case 'RAIL':
      whereBlockAddendum = "AND vs.rail_rte_id IS NOT NULL ";
      break;
    case 'ALL INBOUND':
      whereBlockAddendum = "AND vs.check_in_tsp IS NULL AND vs.inbnd_shpmt_stat_cd = 20 ";
      selectBlockAddendum = selectSchd;
      futures = futuresInbound;
      drags = dragsInbound;
      break;
    case 'INBOUND TR':
      whereBlockAddendum =
        "AND vs.check_in_tsp IS NULL AND vs.inbnd_shpmt_stat_cd = 20 AND vs.inbnd_shpmt_typ_cd BETWEEN 2 AND 3 ";
      selectBlockAddendum = selectSchd;
      futures = futuresInbound;
      drags = dragsInbound;
      break;
    case 'INBOUND MTRL':
      whereBlockAddendum =
        "AND vs.check_in_tsp IS NULL AND vs.inbnd_shpmt_stat_cd = 20 AND vs.inbnd_shpmt_typ_cd = 1 ";
      selectBlockAddendum = selectSchd;
      futures = futuresInbound;
      drags = dragsInbound;
      break;
    case 'INBOUND BEER':
      whereBlockAddendum =
        "AND vs.check_in_tsp IS NULL AND vs.inbnd_shpmt_stat_cd = 20 AND (vs.inbnd_shpmt_typ_cd = 0 OR vs.inbnd_shpmt_typ_cd = 3 OR vs.inbnd_shpmt_typ_cd = 5) ";
      selectBlockAddendum = selectSchd;
      futures = futuresInbound;
      drags = dragsInbound;
      break;
    default:
      whereBlockAddendum = '';
      break;
  }

  let draftWhereAddendum = '';
  if (normalizedProduct === 'DRAUGHT') {
    draftWhereAddendum = "AND vs.dft_pct_qty > 0 ";
  } else if (normalizedProduct === 'PKG ONLY') {
    draftWhereAddendum = "AND vs.dft_pct_qty = 0 ";
  }

  return {
    whereBlockAddendum,
    selectBlockAddendum,
    futures,
    drags,
    draftWhereAddendum,
  };
}

/**
 * Execute SQL query against Databricks SQL API
 */
async function executeDatabricksQuery(sql) {
  try {
    // First, submit the query
    const submitResponse = await axios.post(
      DATABRICKS_CONFIG.apiUrl,
      {
        warehouse_id: DATABRICKS_CONFIG.warehouseId,
        statement: sql,
        wait_timeout: '30s',
        on_wait_timeout: 'CANCEL',
      },
      {
        headers: {
          'Authorization': `Bearer ${DATABRICKS_CONFIG.token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    let result = submitResponse.data;
    
    // If the query is still running, poll for results
    if (result.status?.state === 'PENDING' || result.status?.state === 'RUNNING') {
      const statementId = result.statement_id;
      const maxAttempts = 10;
      let attempts = 0;
      
      while (attempts < maxAttempts && (result.status?.state === 'PENDING' || result.status?.state === 'RUNNING')) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        const pollResponse = await axios.get(
          `${DATABRICKS_CONFIG.apiUrl}/${statementId}`,
          {
            headers: {
              'Authorization': `Bearer ${DATABRICKS_CONFIG.token}`,
            },
          }
        );
        result = pollResponse.data;
        attempts++;
      }
    }
    
    return result;
  } catch (error) {
    if (error.response) {
      console.error('Databricks API error response:', error.response.status, error.response.data);
      throw new Error(
        `Databricks API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
      );
    }
    console.error('Databricks API error:', error.message);
    throw error;
  }
}

/**
 * Build SQL query for weekly schedule (future appointments)
 */
function buildWeeklyQuery(params) {
  const { catalog, schema, selectBlockAddendum, whereBlockAddendum, draftWhereAddendum, futures } = params;

  const sql = `
    SELECT 
      carr.scac_cd AS SCAC,
      vs.pri_xref_shpmt_id AS ShipNum,
      ${selectBlockAddendum}
    FROM ${catalog}.${schema}.vw_shpmt vs
    LEFT JOIN ${catalog}.${schema}.onsite_equip_visit equip 
      ON (equip.outbnd_shpmt_seq_id = vs.shpmt_seq_id OR equip.inbnd_shpmt_seq_id = vs.shpmt_seq_id)
    LEFT JOIN ${catalog}.${schema}.brwy_carr bc ON vs.carr_seq_id = bc.carr_seq_id
    LEFT JOIN ${catalog}.${schema}.wms_carr_mstr_ot carr ON bc.carr_seq_id = carr.carr_seq_id
    WHERE equip.voided_by_nm IS NULL
      AND vs.last_pick_tsp IS NULL
      ${futures}
      ${whereBlockAddendum}
      ${draftWhereAddendum}
  `;

  return sql;
}

/**
 * Build SQL query for drag activity (past 2 days, not checked in)
 */
function buildDragsQuery(params) {
  const { catalog, schema, selectBlockAddendum, whereBlockAddendum, draftWhereAddendum, drags } = params;

  const sql = `
    SELECT 
      carr.scac_cd AS SCAC,
      vs.pri_xref_shpmt_id AS ShipNum,
      ${selectBlockAddendum}
    FROM ${catalog}.${schema}.vw_shpmt vs
    LEFT JOIN ${catalog}.${schema}.onsite_equip_visit equip 
      ON (equip.outbnd_shpmt_seq_id = vs.shpmt_seq_id OR equip.inbnd_shpmt_seq_id = vs.shpmt_seq_id)
    LEFT JOIN ${catalog}.${schema}.brwy_carr bc ON vs.carr_seq_id = bc.carr_seq_id
    LEFT JOIN ${catalog}.${schema}.wms_carr_mstr_ot carr ON bc.carr_seq_id = carr.carr_seq_id
    WHERE vs.last_pick_tsp IS NULL
      ${drags}
      ${whereBlockAddendum}
      ${draftWhereAddendum}
  `;

  return sql;
}

/**
 * Transform Databricks query result to frontend format
 */
function transformResult(result, brewery, loadType) {
  // Debug: Log the full result structure
  console.log('\n=== TRANSFORM RESULT DEBUG ===');
  console.log('Result keys:', Object.keys(result));
  console.log('Status:', result.status);
  console.log('Result keys:', result.result ? Object.keys(result.result) : 'No result');
  
  // Check if query succeeded
  if (result.status?.state !== 'SUCCEEDED') {
    console.warn('Query did not succeed:', result.status);
    return [];
  }
  
  // Handle different response structures
  let dataArray = null;
  let columns = [];
  
  // Try different possible response structures
  if (result.result?.data_array) {
    dataArray = result.result.data_array;
    columns = result.result.columns || [];
  } else if (result.result?.chunks?.[0]?.data_array) {
    // Some API versions return chunks
    dataArray = result.result.chunks[0].data_array;
    columns = result.result.chunks[0].columns || result.result.columns || [];
  } else if (result.data_array) {
    dataArray = result.data_array;
    columns = result.columns || [];
  }
  
  if (!dataArray || !Array.isArray(dataArray)) {
    console.warn('No data_array found in result:', JSON.stringify(result, null, 2));
    return [];
  }
  
  console.log('Columns found:', columns);
  console.log('Number of rows:', dataArray.length);
  if (dataArray.length > 0) {
    console.log('First row sample:', dataArray[0]);
  }
  
  // Build column index map - handle different column formats
  const colMap = {};
  columns.forEach((col, idx) => {
    let colName;
    if (typeof col === 'string') {
      colName = col;
    } else if (col && typeof col === 'object') {
      colName = col.name || col.column_name || col.text || String(col);
    } else {
      colName = String(col);
    }
    // Map both uppercase and lowercase versions
    colMap[colName] = idx;
    colMap[colName.toUpperCase()] = idx;
    colMap[colName.toLowerCase()] = idx;
  });
  
  console.log('Column map:', colMap);
  
  const transformed = dataArray.map((row, rowIdx) => {
    if (!Array.isArray(row)) {
      console.warn(`Row ${rowIdx} is not an array:`, row);
      return null;
    }
    
    // Extract SCAC - try multiple possible column names
    const scac = (row[colMap.SCAC] ?? row[colMap.scac_cd] ?? row[colMap.SCAC_CD] ?? '') || '';
    const shipNum = (row[colMap.ShipNum] ?? row[colMap.shipnum] ?? row[colMap.SHIPNUM] ?? row[colMap.pri_xref_shpmt_id] ?? '') || '';
    
    // Extract date and time fields
    const pullDate = row[colMap.PULL_DATE] ?? row[colMap.pull_date] ?? null;
    const pullTime = row[colMap.PULL_TIME] ?? row[colMap.pull_time] ?? null;
    const schdDate = row[colMap.SCHD_DATE] ?? row[colMap.schd_date] ?? null;
    const schdHr = row[colMap.SCHD_HR] ?? row[colMap.schd_hr] ?? row[colMap.SCHD_HR] ?? null;
    
    // Use PULL fields if available, otherwise SCHD fields
    const dateField = pullDate || schdDate;
    const timeField = pullTime || schdHr;
    
    // Determine product type from draft percentage
    const dftPct = row[colMap.dft_pct_qty] ?? row[colMap.DFT_PCT_QTY];
    let productType = 'ALL';
    if (dftPct !== null && dftPct !== undefined) {
      productType = dftPct > 0 ? 'DRAUGHT' : 'PKG ONLY';
    }
     
    // Build datetime from date and time fields for sorting
    let datetime = null;
    if (dateField && timeField) {
      try {
        const dateTimeStr = `${dateField} ${timeField}`;
        datetime = new Date(dateTimeStr);
        // If parsing failed, set to null
        if (Number.isNaN(datetime.getTime())) {
          datetime = null;
        }
      } catch (e) {
        console.warn('Error parsing datetime:', e, dateField, timeField);
        datetime = null;
      }
    }
    
    const record = {
      brewery,
      scac: scac || '—',
      shipNum: shipNum || '—',
      pullDate: pullDate || null,
      pullTime: pullTime || null,
      schdDate: schdDate || null,
      schdHr: schdHr || null,
      datetime: datetime ? datetime.toISOString() : null,
      loadTags: [loadType],
      productType,
    };
    
    if (rowIdx === 0) {
      console.log('First transformed record:', record);
    }
    
    return record;
  }).filter(record => record !== null);
  
  console.log(`Transformed ${transformed.length} records`);
  console.log('=== END TRANSFORM DEBUG ===\n');
  
  return transformed;
}

/**
 * GET /schedule - Main endpoint for fetching schedule data
 */
app.get('/schedule', async (req, res) => {
  try {
    const {
      brewery,
      catalog,
      schema,
      loadType,
      productType,
      whereBlockAddendum,
      draftWhereAddendum,
      dateFieldType,
      futureDays,
    } = req.query;

    // Validate required parameters
    if (!brewery || !catalog || !schema) {
      return res.status(400).json({
        error: 'Missing required parameters: brewery, catalog, schema',
      });
    }

    const loadTypeValue = loadType || 'ALL OUTBOUND';
    const productTypeValue = productType || 'ALL';
    const components = buildQueryComponents(loadTypeValue, productTypeValue, futureDays || 7);

    const params = {
      brewery,
      catalog,
      schema,
      loadType: loadTypeValue,
      productType: productTypeValue,
      ...components,
    };

    // Execute weekly query
    const weeklySql = buildWeeklyQuery(params);
    console.log('\n========== WEEKLY QUERY ==========');
    console.log(weeklySql);
    console.log('===================================\n');
    
    const weeklyResult = await executeDatabricksQuery(weeklySql);
    const weekly = transformResult(weeklyResult, brewery, params.loadType);
    console.log(`Weekly results: ${weekly.length} records`);

    // Execute drags query
    const dragsSql = buildDragsQuery(params);
    console.log('\n========== DRAGS QUERY ==========');
    console.log(dragsSql);
    console.log('==================================\n');
    
    const dragsResult = await executeDatabricksQuery(dragsSql);
    const drags = transformResult(dragsResult, brewery, params.loadType);
    console.log(`Drags results: ${drags.length} records`);

    // Include query info in response for debugging
    const response = {
      weekly,
      drags,
      _debug: {
        weeklyQuery: weeklySql,
        dragsQuery: dragsSql,
        params: {
          brewery,
          catalog,
          schema,
          loadType: params.loadType,
          productType: params.productType,
          futureDays: futureDays || 7,
        },
      },
    };
    
    res.json(response);
  } catch (error) {
    console.error('Error fetching schedule:', error);
    res.status(500).json({
      error: 'Failed to fetch schedule data',
      message: error.message,
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`WMS Scheduler API server running on http://localhost:${PORT}`);
  console.log(`Databricks API: ${DATABRICKS_CONFIG.apiUrl}`);
  console.log(`Warehouse ID: ${DATABRICKS_CONFIG.warehouseId}`);
});

