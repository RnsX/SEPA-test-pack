# SEPA pacs.008 parser test pack

Generated: 2026-09-13

## Scope

Four FI-to-FI customer credit transfer fixtures:
- SCT / pacs.008.001.08
- SCT Inst / pacs.008.001.08
- SCT / pacs.008.001.09
- SCT Inst / pacs.008.001.09

The current EPC 2025 SCT and SCT Inst Inter-PSP Implementation Guidelines are based on the **2019 ISO 20022 message version** and explicitly use **pacs.008.001.08**. Therefore, the two `.09` files are deliberately supplied as ISO-version parser compatibility fixtures carrying SEPA-style values; they must **not** be treated as current EPC TVS-conformant SEPA messages.

The current EPC address transition permits unstructured address use only until **15 November 2026**. The V08 instant fixture includes two repeated `<AdrLine>` occurrences specifically to test array/repeated-tag parsing before that cut-off. Structured-address fixtures are also included.

## Coverage strategy

The fixtures are intentionally "wide": they populate core payment identifiers, UETR, group and transaction payment type information, SCT Inst `INST`, parties, ultimate parties, initiating party, organisation/private identification alternatives, structured and unstructured postal addresses, two repeated `AdrLine` elements, country of residence, contact details, debtor/creditor accounts, aliases/proxies, debtor/creditor agents, purpose, and both structured and unstructured remittance alternatives.

Mutually-exclusive ISO `xs:choice` alternatives cannot all legally appear in a single XML instance. Alternatives are distributed across the four fixtures instead of forcing an invalid "everything at once" document.

## Validation performed

All four files:
- are XML well-formed;
- follow the pacs.008 element ordering used by the ISO 20022 V08/V09 message definitions for the populated elements;
- use EUR for SEPA settlement amounts;
- use `SLEV` charge bearer;
- use `SEPA` service level;
- use `INST` for the SCT Inst fixtures;
- use one transaction per SCT Inst message;
- use milliseconds and an explicit UTC offset / `Z` on SCT Inst acceptance timestamps;
- cap repeated `AdrLine` at two.

Current-EPC conformance is asserted only for the `.08` fixtures. The `.09` fixtures are explicitly non-EPC-version fixtures.

## Cross-reference CSV

`payment_parser_cross_reference.csv` contains four rows. Columns are flattened XML leaf paths, ordered with:
1. involved parties,
2. agents,
3. accounts,
4. payment IDs and payment type information,
5. remaining transaction fields,
6. remittance,
7. group header.

Repeated XML siblings are indexed in the column names, e.g. `AdrLine[1]`, `AdrLine[2]`.

## Structural checks

- sct_inst_v08_pacs_008_001_08.xml: PASS
- sct_inst_v09_pacs_008_001_09.xml: PASS
- sct_v08_pacs_008_001_08.xml: PASS
- sct_v09_pacs_008_001_09.xml: PASS

## Authoritative references

- EPC 2025 SCT Inter-PSP Implementation Guidelines v1.0 / 2025 SCT Rulebook v1.1.
- EPC 2025 SCT Inst Inter-PSP Implementation Guidelines v1.0 / 2025 SCT Inst Rulebook v1.1.
- ISO 20022 pacs.008 message definitions / archive for V08 and V09.

Important: EPC's published XSDs are Technical Validation Subsets (TVSs), and EPC states they are not production schemas. Production messages use the default ISO 20022 namespace.
