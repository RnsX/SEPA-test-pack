CSV -> XML party/agent/narrative generator

CSV header rows:
  Row 1: user-friendly field names
  Row 2: XML tag/path (blank for non-XML metadata)
  Row 3: machine-readable names used by the script
  Row 4+: data

Filename-only metadata columns:
  transaction id
  type        (example values: SEPA, SEPA_INST)
  direction

These 3 values are NOT written into XML.
Output filename format:
  <transaction id>-<direction>-<type>.xml
Example:
  id123-outgoing-SEPA.xml
  id124-outgoing-SEPA_INST.xml

Run:
  node generate-party-narrative.js
or:
  node generate-party-narrative.js /path/to/party-agent-narrative.csv

No SEPA/EPC business-rule validation is performed. The script reads the CSV values and maps populated XML fields into the generated XML fragment.
