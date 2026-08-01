// Stamped onto every Figure's provenance and every ReportDocument.
//
// ENGINE_VERSION changes when a calculation changes, so a report printed last
// month can be told apart from the same report re-run today under different
// rules. DOCUMENT_SCHEMA_VERSION changes when the ReportDocument shape changes,
// so an old stored snapshot can still be rendered by a newer app.
const ENGINE_VERSION = '1.0.0'
const DOCUMENT_SCHEMA_VERSION = 1

module.exports = { ENGINE_VERSION, DOCUMENT_SCHEMA_VERSION }
