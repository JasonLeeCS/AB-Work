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

/**
 * Execute SQL query against Databricks SQL API
 */
async function executeDatabricksQuery(sql) {
  try {
    const response = await axios.post(
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

    return response.data;
  } catch (error) {
    if (error.response) {
      throw new Error(
        `Databricks API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
      );
    }
    throw error;
  }
}

/**
 * Build SQL query for weekly schedule (future appointments)
 */
function buildWeeklyQuery(params) {
  const { catalog, schema, whereBlockAddendum, draftWhereAddendum, dateFieldType, futureDays } = params;
  
  // Determine date fields based on dateFieldType
  const dateField = dateFieldType === 'SCHD' ? 'SCHD_DATE' : 'PULL_DATE';
  const timeField = dateFieldType === 'SCHD' ? 'SCHD_HR' : 'PULL_TIME';
  
  // Calculate date range
  const today = new Date();
  const futureDate = new Date(today);
  futureDate.setDate(futureDate.getDate() + parseInt(futureDays));
  
  const todayStr = today.toISOString().split('T')[0];
  const futureStr = futureDate.toISOString().split('T')[0];
  
  const sql = `
    SELECT 
      carr.scac_cd AS SCAC,
      vs.pri_xref_shpmt_id AS ShipNum,
      ${dateField} AS PULL_DATE,
      ${timeField} AS PULL_TIME,
      vs.spotting_serv_id,
      bc.ded_flg,
      vs.dft_pct_qty,
      vs.check_in_tsp,
      vs.inbnd_shpmt_stat_cd,
      vs.inbnd_shpmt_typ_cd,
      vs.rail_rte_id,
      bc.carr_seq_id,
      '${params.brewery}' AS brewery
    FROM ${catalog}.${schema}.v_shipment vs
    LEFT JOIN ${catalog}.${schema}.b_carr_seq bc ON vs.shipment_id = bc.shipment_id
    LEFT JOIN ${catalog}.${schema}.carrier carr ON bc.carr_seq_id = carr.carr_seq_id
    WHERE ${dateField} >= '${todayStr}' 
      AND ${dateField} <= '${futureStr}'
      ${whereBlockAddendum}
      ${draftWhereAddendum}
    ORDER BY ${dateField}, ${timeField}
  `;
  
  return sql;
}

/**
 * Build SQL query for drag activity (past 2 days, not checked in)
 */
function buildDragsQuery(params) {
  const { catalog, schema, whereBlockAddendum, draftWhereAddendum } = params;
  
  // Past 2 days
  const today = new Date();
  const pastDate = new Date(today);
  pastDate.setDate(pastDate.getDate() - 2);
  
  const todayStr = today.toISOString().split('T')[0];
  const pastStr = pastDate.toISOString().split('T')[0];
  
  const sql = `
    SELECT 
      carr.scac_cd AS SCAC,
      vs.pri_xref_shpmt_id AS ShipNum,
      PULL_DATE,
      PULL_TIME,
      vs.spotting_serv_id,
      bc.ded_flg,
      vs.dft_pct_qty,
      vs.check_in_tsp,
      vs.inbnd_shpmt_stat_cd,
      vs.inbnd_shpmt_typ_cd,
      vs.rail_rte_id,
      bc.carr_seq_id,
      '${params.brewery}' AS brewery
    FROM ${catalog}.${schema}.v_shipment vs
    LEFT JOIN ${catalog}.${schema}.b_carr_seq bc ON vs.shipment_id = bc.shipment_id
    LEFT JOIN ${catalog}.${schema}.carrier carr ON bc.carr_seq_id = carr.carr_seq_id
    WHERE PULL_DATE >= '${pastStr}' 
      AND PULL_DATE <= '${todayStr}'
      AND vs.check_in_tsp IS NULL
      ${whereBlockAddendum}
      ${draftWhereAddendum}
    ORDER BY PULL_DATE, PULL_TIME
  `;
  
  return sql;
}

/**
 * Transform Databricks query result to frontend format
 */
function transformResult(result, brewery, loadType) {
  // Check if query succeeded
  if (result.status?.state !== 'SUCCEEDED') {
    console.warn('Query did not succeed:', result.status);
    return [];
  }
  
  if (!result.result || !result.result.data_array) {
    return [];
  }
  
  const columns = result.result.columns || [];
  const rows = result.result.data_array || [];
  
  // Build column index map
  const colMap = {};
  columns.forEach((col, idx) => {
    const colName = typeof col === 'string' ? col : col.name;
    colMap[colName] = idx;
  });
  
  return rows.map(row => {
    const record = {
      brewery: brewery,
      SCAC: row[colMap.SCAC] || row[colMap.scac_cd] || '',
      ShipNum: row[colMap.ShipNum] || row[colMap.pri_xref_shpmt_id] || '',
      PULL_DATE: row[colMap.PULL_DATE] || null,
      PULL_TIME: row[colMap.PULL_TIME] || null,
      datetime: null,
      loadTags: [loadType],
      productType: 'ALL',
    };
    
    // Determine product type from draft percentage
    const dftPct = row[colMap.dft_pct_qty];
    if (dftPct !== null && dftPct !== undefined) {
      record.productType = dftPct > 0 ? 'DRAUGHT' : 'PKG ONLY';
    }
    
    // Build datetime from date and time fields
    if (record.PULL_DATE && record.PULL_TIME) {
      try {
        // Handle various date/time formats
        let dateTimeStr;
        if (typeof record.PULL_DATE === 'string' && typeof record.PULL_TIME === 'string') {
          dateTimeStr = `${record.PULL_DATE} ${record.PULL_TIME}`;
        } else if (record.PULL_DATE instanceof Date) {
          dateTimeStr = record.PULL_DATE.toISOString();
        } else {
          dateTimeStr = new Date(record.PULL_DATE).toISOString();
        }
        record.datetime = new Date(dateTimeStr).toISOString();
      } catch (e) {
        console.warn('Error parsing datetime:', e);
        record.datetime = new Date().toISOString();
      }
    } else {
      record.datetime = new Date().toISOString();
    }
    
    return record;
  });
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

    const params = {
      brewery,
      catalog,
      schema,
      loadType: loadType || 'ALL OUTBOUND',
      productType: productType || 'ALL',
      whereBlockAddendum: whereBlockAddendum || '',
      draftWhereAddendum: draftWhereAddendum || '',
      dateFieldType: dateFieldType || 'PULL',
      futureDays: futureDays || 7,
    };

    // Execute weekly query
    const weeklySql = buildWeeklyQuery(params);
    console.log('Executing weekly query:', weeklySql.substring(0, 200) + '...');
    
    const weeklyResult = await executeDatabricksQuery(weeklySql);
    const weekly = transformResult(weeklyResult, brewery, params.loadType);

    // Execute drags query
    const dragsSql = buildDragsQuery(params);
    console.log('Executing drags query:', dragsSql.substring(0, 200) + '...');
    
    const dragsResult = await executeDatabricksQuery(dragsSql);
    const drags = transformResult(dragsResult, brewery, params.loadType);

    res.json({
      weekly,
      drags,
    });
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

