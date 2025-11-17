# WMS Scheduler - Brewery Load Scheduler

A modern, browser-based replacement for the legacy Excel VBA scheduler. This application connects to Databricks to fetch real-time warehouse schedule data.

## Features

- **Modern UI**: Glass morphism design with dark mode
- **Real-time Data**: Connects to Databricks SQL API for live warehouse data
- **Multiple Breweries**: Support for 12 AB InBev breweries
- **Flexible Filtering**: Filter by load type, product type, and date range
- **Export**: Export schedule data to CSV

## Project Structure

```
AB-Work/
├── index.html          # Frontend HTML
├── script.js           # Frontend JavaScript
├── styles.css          # Frontend styles
├── server.js           # Backend Express API server
├── config.json         # Databricks configuration (credentials)
├── package.json        # Node.js dependencies
└── README.md           # This file
```

## Setup Instructions

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn

### Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure Databricks credentials:**
   The `config.json` file is already configured with your Databricks credentials:
   - Server hostname
   - HTTP path (warehouse endpoint)
   - Personal access token

3. **Start the backend server:**
   ```bash
   npm start
   ```
   The server will run on `http://localhost:3000`

4. **Open the frontend:**
   - Open `index.html` in your web browser
   - Or use a local web server (e.g., `python -m http.server 8000`)
   - The frontend is already configured to connect to `http://localhost:3000`

### Usage

1. Select a brewery from the dropdown
2. Choose load type, product type, and date range
3. Click "Refresh Schedule" to fetch data from Databricks
4. View the weekly load schedule and drag activity
5. Export data to CSV if needed

## API Endpoints

### GET /schedule
Fetches schedule data from Databricks.

**Query Parameters:**
- `brewery` - Brewery name (required)
- `catalog` - Databricks catalog (required)
- `schema` - Databricks schema (required)
- `loadType` - Load type filter
- `productType` - Product type filter
- `whereBlockAddendum` - SQL WHERE clause additions
- `draftWhereAddendum` - Draft percentage filter
- `dateFieldType` - Date field type (PULL or SCHD)
- `futureDays` - Number of future days to include

**Response:**
```json
{
  "weekly": [...],
  "drags": [...]
}
```

### GET /health
Health check endpoint.

## Security Note

⚠️ **Important**: The `config.json` file contains sensitive Databricks credentials. Do not commit this file to version control. Consider using environment variables or a secrets management system for production deployments.

## Troubleshooting

- **Connection errors**: Verify Databricks credentials in `config.json`
- **CORS errors**: Ensure the backend server is running and accessible
- **Query errors**: Check that the catalog/schema names are correct for your Databricks workspace
