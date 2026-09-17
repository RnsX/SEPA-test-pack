SEPA SCT / SCT INST pacs.008.001.08 CSV generator
=================================================

CSV layout
----------
Row 1: user-friendly field name
Row 2: ISO 20022 XML tag/path
Row 3: machine-readable column name used by generate-sepa.js
Row 4+: one payment per row

Payment types
-------------
payment type = SCT
payment type = SCT INST

Output filename
---------------
<metadata id>-<metadata direction>-<metadata scheme>.xml
Example: id123-outgoing-SEPA.xml

Payment-chain agent coverage
----------------------------
The CSV and generator include the following pacs.008 payment-chain agents for
both SCT and SCT INST:

- PrvsInstgAgt1 + PrvsInstgAgt1Acct
- PrvsInstgAgt2 + PrvsInstgAgt2Acct
- PrvsInstgAgt3 + PrvsInstgAgt3Acct
- InstgAgt
- InstdAgt
- IntrmyAgt1 + IntrmyAgt1Acct
- IntrmyAgt2 + IntrmyAgt2Acct
- IntrmyAgt3 + IntrmyAgt3Acct
- DbtrAgt + DbtrAgtAcct
- CdtrAgt + CdtrAgtAcct

For each optional agent account, the CSV supports either:
- Id/IBAN, or
- Id/Othr/Id
Do not populate both for the same account.

The Debtor Agent and Creditor Agent BIC columns retain their EPC business
attribute names:
- AT-D002 BIC of Originator PSP -> DbtrAgt/FinInstnId/BICFI
- AT-C002 BIC of Beneficiary PSP -> CdtrAgt/FinInstnId/BICFI

Ultimate parties
----------------
- AT-P006 / AT-P007 -> UltmtDbtr
- AT-E007 / AT-E010 -> UltmtCdtr

Run
---
node generate-sepa.js
or:
node generate-sepa.js /path/to/sepa-payments.csv

No external npm packages are required.
