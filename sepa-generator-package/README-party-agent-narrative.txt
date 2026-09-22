Party / Agent / Narrative XML generator
======================================

Files:
- party-agent-narrative.csv
- generate-party-narrative.js

Run:
  node generate-party-narrative.js

Or:
  node generate-party-narrative.js /path/to/party-agent-narrative.csv

CSV layout:
- row 1: user-friendly field names
- row 2: ISO 20022 XML paths / tags
- row 3: machine-readable field names
- row 4+: data

Output:
- payment-001.xml
- payment-002.xml
- ...

Scope:
This intentionally generates only a CdtTrfTxInf XML fragment containing involved
parties, accounts, agent chain / agent accounts, amount/currency, purpose and
remittance narrative. It deliberately excludes SEPA scheme/payment metadata,
message/group headers, payment type, IDs/UETR, settlement metadata, charge bearer,
status/inquiry/return/recall lifecycle fields, and SCT-vs-SCT-Inst branching.

No EPC/SEPA business-rule validation is performed.
