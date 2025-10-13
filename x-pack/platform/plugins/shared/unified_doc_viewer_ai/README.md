# Unified Doc Viewer AI Plugin

This plugin adds AI-powered document analysis capabilities to the Kibana Discover document flyout.

## Features

- **AI Tab**: Adds a new "AI" tab to the document detail flyout alongside Table and JSON tabs
- **Document Explanation**: Uses LLM to analyze documents and provide:
  - Concise title describing the document
  - Brief summary of key information
  - Detailed explanation of field values and their significance
- **Enterprise License**: Requires an Enterprise license to use AI features
- **Automatic Connector Detection**: Automatically finds and uses the Elastic Managed LLM connector

## Requirements

- Enterprise license
- Configured LLM connector (Elastic Managed LLM or compatible .inference connector)

## Usage

1. Open a document in Discover by clicking the expand icon in the document table
2. Navigate to the "AI" tab in the flyout
3. Click "Explain with AI" to analyze the document
4. View the structured analysis with title, summary, and description
5. Click "Re-analyze" to get a fresh analysis

## Architecture

### Client-side
- `DocViewerAi`: Main React component for the AI tab
- `useDocumentAi`: React hook for managing AI analysis state and API calls
- `AiExplanation`: Component for displaying analysis results

### Server-side
- `explain_document` route: API endpoint for document analysis
- `LlmClient`: Client for interacting with LLM connectors
- `getLlmConnectorId`: Helper to find appropriate LLM connector

## API

### POST /internal/unified_doc_viewer_ai/explain_document

**Request Body:**
```json
{
  "document": { ... },
  "dataViewId": "optional-data-view-id"
}
```

**Response:**
```json
{
  "title": "Document title",
  "summary": "Brief summary",
  "description": "Detailed explanation"
}
```

## Future Enhancements (Step 2)

- Automatic resource field identification
- Context-aware analysis using surrounding log messages
- Enhanced analysis with temporal context (±5 messages based on timestamp)

