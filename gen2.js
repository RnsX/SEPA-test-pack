// Zero-dependency CSV -> complete pacs.008.001.08 XML generator.
//
// CSV rows 1-3:
//   1 = friendly names
//   2 = XML path hints
//   3 = machine-readable field names
//
// CSV metadata fields transaction id / type / direction are filename-only.
// They are NOT serialized into XML.
//
// No SEPA/EPC business validation is performed. Populated CSV values are serialized.
// Technical elements that are required to make a complete pacs.008 message but are not
// present in the CSV are supplied internally by this script.
//
// type is used only to choose the internal technical profile:
//   SEPA_INST -> hardcoded SvcLvl=SEPA + LclInstrm=INST + AccptncDtTm
//   anything else -> hardcoded SvcLvl=SEPA
// The literal CSV metadata values are never written to XML.

const fs = require('fs');
const path = require('path');

const SCRIPT_DIR = __dirname;
const csvPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(SCRIPT_DIR, 'party-agent-narrative.csv');

const NS = 'urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08';

// Technical values are intentionally not CSV columns.
const TECH = Object.freeze({
  messageId: 'CSV-GENERATOR-MSG',
  numberOfTransactions: '1',
  settlementMethod: 'CLRG',
  serviceLevel: 'SEPA',
  instantLocalInstrument: 'INST',
  endToEndId: 'NOTPROVIDED',
  chargeBearer: 'SLEV',
  fallbackAmount: '0.01',
  fallbackCurrency: 'EUR'
});

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }

  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  if (rows.length < 3) throw new Error('CSV must contain the three header rows.');

  const headers = rows[2].map((h, i) => (i === 0 ? h.replace(/^\uFEFF/, '') : h).trim());
  return rows.slice(3)
    .filter(cells => cells.some(cell => String(cell).trim() !== ''))
    .map((cells, idx) => {
      const obj = { __rowNumber: idx + 4 };
      headers.forEach((h, i) => { obj[h] = cells[i] === undefined ? '' : cells[i]; });
      return obj;
    });
}

function value(row, key) { return String(row[key] ?? '').trim(); }
function xmlEscape(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
function add(lines, level, xml) { lines.push(`${'  '.repeat(level)}${xml}`); }
function addText(lines, level, tag, v) {
  const x = String(v ?? '').trim();
  if (x !== '') add(lines, level, `<${tag}>${xmlEscape(x)}</${tag}>`);
}

function addFinInst(lines, level, tag, bic, force = false) {
  const v = String(bic ?? '').trim();
  if (!v && !force) return;
  add(lines, level, `<${tag}>`);
  add(lines, level + 1, '<FinInstnId>');
  addText(lines, level + 2, 'BICFI', v);
  add(lines, level + 1, '</FinInstnId>');
  add(lines, level, `</${tag}>`);
}

function addAgentAccount(lines, level, tag, iban, otherId) {
  const i = String(iban ?? '').trim();
  const o = String(otherId ?? '').trim();
  if (!i && !o) return;
  add(lines, level, `<${tag}>`);
  add(lines, level + 1, '<Id>');
  // ISO AccountIdentification4Choice permits one account identifier choice.
  // If both CSV columns are populated, IBAN is serialized first/preferred.
  if (i) {
    addText(lines, level + 2, 'IBAN', i);
  } else {
    add(lines, level + 2, '<Othr>');
    addText(lines, level + 3, 'Id', o);
    add(lines, level + 2, '</Othr>');
  }
  add(lines, level + 1, '</Id>');
  add(lines, level, `</${tag}>`);
}

function addPartyIdentification(lines, level, code, idType, scheme) {
  const id = String(code ?? '').trim();
  if (!id) return;
  const type = String(idType ?? '').trim().toUpperCase();
  const schemeValue = String(scheme ?? '').trim();

  add(lines, level, '<Id>');
  if (type === 'PRIVATE_OTHER') {
    add(lines, level + 1, '<PrvtId>');
    add(lines, level + 2, '<Othr>');
    addText(lines, level + 3, 'Id', id);
    if (schemeValue) {
      add(lines, level + 3, '<SchmeNm>');
      addText(lines, level + 4, 'Prtry', schemeValue);
      add(lines, level + 3, '</SchmeNm>');
    }
    add(lines, level + 2, '</Othr>');
    add(lines, level + 1, '</PrvtId>');
  } else {
    add(lines, level + 1, '<OrgId>');
    if (type === 'ANYBIC') addText(lines, level + 2, 'AnyBIC', id);
    else if (type === 'LEI') addText(lines, level + 2, 'LEI', id);
    else {
      add(lines, level + 2, '<Othr>');
      addText(lines, level + 3, 'Id', id);
      if (schemeValue) {
        add(lines, level + 3, '<SchmeNm>');
        addText(lines, level + 4, 'Prtry', schemeValue);
        add(lines, level + 3, '</SchmeNm>');
      }
      add(lines, level + 2, '</Othr>');
    }
    add(lines, level + 1, '</OrgId>');
  }
  add(lines, level, '</Id>');
}

function addPostalAddress(lines, level, row, prefix) {
  const fields = [
    ['StrtNm', value(row, `${prefix} address street name`)],
    ['BldgNb', value(row, `${prefix} address building number`)],
    ['PstCd', value(row, `${prefix} address post code`)],
    ['TwnNm', value(row, `${prefix} address town name`)],
    ['Ctry', value(row, `${prefix} address country`)],
    ['AdrLine', value(row, `${prefix} address line`)]
  ];
  if (!fields.some(([, v]) => Boolean(v))) return;
  add(lines, level, '<PstlAdr>');
  for (const [tag, v] of fields) addText(lines, level + 1, tag, v);
  add(lines, level, '</PstlAdr>');
}

function addParty(lines, level, tag, row, prefix, force = false) {
  const name = value(row, `${prefix} name`);
  const id = value(row, `${prefix} identification code`);
  const countryOfResidence = value(row, `${prefix} country of residence`);
  const hasAddress = [
    'address street name', 'address building number', 'address post code',
    'address town name', 'address country', 'address line'
  ].some(s => value(row, `${prefix} ${s}`));

  if (!force && !name && !id && !countryOfResidence && !hasAddress) return;

  add(lines, level, `<${tag}>`);
  addText(lines, level + 1, 'Nm', name);
  addPostalAddress(lines, level + 1, row, prefix);
  addPartyIdentification(
    lines,
    level + 1,
    id,
    value(row, `${prefix} identification type`),
    value(row, `${prefix} identification scheme`)
  );
  addText(lines, level + 1, 'CtryOfRes', countryOfResidence);
  add(lines, level, `</${tag}>`);
}

function addAccount(lines, level, tag, iban, proxy) {
  const i = String(iban ?? '').trim();
  const p = String(proxy ?? '').trim();
  if (!i && !p) return;
  add(lines, level, `<${tag}>`);
  if (i) {
    add(lines, level + 1, '<Id>');
    addText(lines, level + 2, 'IBAN', i);
    add(lines, level + 1, '</Id>');
  }
  if (p) {
    add(lines, level + 1, '<Prxy>');
    addText(lines, level + 2, 'Id', p);
    add(lines, level + 1, '</Prxy>');
  }
  add(lines, level, `</${tag}>`);
}

function addPurpose(lines, level, purpose) {
  const v = String(purpose ?? '').trim();
  if (!v) return;
  add(lines, level, '<Purp>');
  // No rule validation: preserve the CSV value as proprietary purpose text.
  addText(lines, level + 1, 'Prtry', v);
  add(lines, level, '</Purp>');
}

function addRemittance(lines, level, row) {
  const narrative = value(row, 'payment narrative');
  if (!narrative) return;
  const mode = value(row, 'remittance mode').toUpperCase();

  add(lines, level, '<RmtInf>');
  if (mode === 'SCOR') {
    add(lines, level + 1, '<Strd>');
    add(lines, level + 2, '<CdtrRefInf>');
    add(lines, level + 3, '<Tp>');
    add(lines, level + 4, '<CdOrPrtry>');
    addText(lines, level + 5, 'Cd', 'SCOR');
    add(lines, level + 4, '</CdOrPrtry>');
    addText(lines, level + 4, 'Issr', value(row, 'remittance issuer'));
    add(lines, level + 3, '</Tp>');
    addText(lines, level + 3, 'Ref', narrative);
    add(lines, level + 2, '</CdtrRefInf>');
    add(lines, level + 1, '</Strd>');
  } else {
    addText(lines, level + 1, 'Ustrd', narrative);
  }
  add(lines, level, '</RmtInf>');
}

function buildMessage(row) {
  const now = new Date();
  const nowDateTime = now.toISOString();
  const today = nowDateTime.slice(0, 10);
  const instant = value(row, 'type').toUpperCase() === 'SEPA_INST';
  const amount = value(row, 'payment amount') || TECH.fallbackAmount;
  const currency = value(row, 'payment currency') || TECH.fallbackCurrency;

  const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
  add(lines, 0, `<Document xmlns="${NS}">`);
  add(lines, 1, '<FIToFICstmrCdtTrf>');

  // Required pacs.008 group-header envelope. None of these are CSV columns.
  add(lines, 2, '<GrpHdr>');
  addText(lines, 3, 'MsgId', TECH.messageId);
  addText(lines, 3, 'CreDtTm', nowDateTime);
  addText(lines, 3, 'NbOfTxs', TECH.numberOfTransactions);
  add(lines, 3, '<SttlmInf>');
  addText(lines, 4, 'SttlmMtd', TECH.settlementMethod);
  add(lines, 3, '</SttlmInf>');
  add(lines, 2, '</GrpHdr>');

  add(lines, 2, '<CdtTrfTxInf>');

  // Required technical transaction identifiers; not sourced from filename metadata.
  add(lines, 3, '<PmtId>');
  addText(lines, 4, 'EndToEndId', TECH.endToEndId);
  add(lines, 3, '</PmtId>');

  // Technical SEPA profile is internal. The CSV metadata literal is never serialized.
  add(lines, 3, '<PmtTpInf>');
  add(lines, 4, '<SvcLvl>');
  addText(lines, 5, 'Cd', TECH.serviceLevel);
  add(lines, 4, '</SvcLvl>');
  if (instant) {
    add(lines, 4, '<LclInstrm>');
    addText(lines, 5, 'Cd', TECH.instantLocalInstrument);
    add(lines, 4, '</LclInstrm>');
  }
  add(lines, 3, '</PmtTpInf>');

  add(lines, 3, `<IntrBkSttlmAmt Ccy="${xmlEscape(currency)}">${xmlEscape(amount)}</IntrBkSttlmAmt>`);
  addText(lines, 3, 'IntrBkSttlmDt', today);
  if (instant) addText(lines, 3, 'AccptncDtTm', nowDateTime);
  addText(lines, 3, 'ChrgBr', TECH.chargeBearer);

  // Optional routing chain from CSV, in pacs.008 schema order.
  addFinInst(lines, 3, 'PrvsInstgAgt1', value(row, 'previous instructing agent 1 BIC'));
  addAgentAccount(lines, 3, 'PrvsInstgAgt1Acct', value(row, 'previous instructing agent 1 account IBAN'), value(row, 'previous instructing agent 1 account other id'));
  addFinInst(lines, 3, 'PrvsInstgAgt2', value(row, 'previous instructing agent 2 BIC'));
  addAgentAccount(lines, 3, 'PrvsInstgAgt2Acct', value(row, 'previous instructing agent 2 account IBAN'), value(row, 'previous instructing agent 2 account other id'));
  addFinInst(lines, 3, 'PrvsInstgAgt3', value(row, 'previous instructing agent 3 BIC'));
  addAgentAccount(lines, 3, 'PrvsInstgAgt3Acct', value(row, 'previous instructing agent 3 account IBAN'), value(row, 'previous instructing agent 3 account other id'));
  addFinInst(lines, 3, 'InstgAgt', value(row, 'instructing agent BIC'));
  addFinInst(lines, 3, 'InstdAgt', value(row, 'instructed agent BIC'));
  addFinInst(lines, 3, 'IntrmyAgt1', value(row, 'intermediary agent 1 BIC'));
  addAgentAccount(lines, 3, 'IntrmyAgt1Acct', value(row, 'intermediary agent 1 account IBAN'), value(row, 'intermediary agent 1 account other id'));
  addFinInst(lines, 3, 'IntrmyAgt2', value(row, 'intermediary agent 2 BIC'));
  addAgentAccount(lines, 3, 'IntrmyAgt2Acct', value(row, 'intermediary agent 2 account IBAN'), value(row, 'intermediary agent 2 account other id'));
  addFinInst(lines, 3, 'IntrmyAgt3', value(row, 'intermediary agent 3 BIC'));
  addAgentAccount(lines, 3, 'IntrmyAgt3Acct', value(row, 'intermediary agent 3 account IBAN'), value(row, 'intermediary agent 3 account other id'));

  // Parties/accounts/primary agents from CSV.
  addParty(lines, 3, 'UltmtDbtr', row, 'ultimate debtor');
  addParty(lines, 3, 'Dbtr', row, 'debtor', true);
  addAccount(lines, 3, 'DbtrAcct', value(row, 'debtor account IBAN'), value(row, 'debtor account proxy alias'));
  addFinInst(lines, 3, 'DbtrAgt', value(row, 'debtor agent BIC'), true);
  addAgentAccount(lines, 3, 'DbtrAgtAcct', value(row, 'debtor agent account IBAN'), value(row, 'debtor agent account other id'));
  addFinInst(lines, 3, 'CdtrAgt', value(row, 'creditor agent BIC'), true);
  addAgentAccount(lines, 3, 'CdtrAgtAcct', value(row, 'creditor agent account IBAN'), value(row, 'creditor agent account other id'));
  addParty(lines, 3, 'Cdtr', row, 'creditor', true);
  addAccount(lines, 3, 'CdtrAcct', value(row, 'creditor account IBAN'), value(row, 'creditor account proxy alias'));
  addParty(lines, 3, 'UltmtCdtr', row, 'ultimate creditor');

  addPurpose(lines, 3, value(row, 'payment purpose'));
  addRemittance(lines, 3, row);

  add(lines, 2, '</CdtTrfTxInf>');
  add(lines, 1, '</FIToFICstmrCdtTrf>');
  add(lines, 0, '</Document>');
  return `${lines.join('\n')}\n`;
}

function main() {
  if (!fs.existsSync(csvPath)) throw new Error(`CSV file not found: ${csvPath}`);
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));

  rows.forEach((row) => {
    // Filename-only metadata. These values are never serialized to XML.
    const transactionId = value(row, 'transaction id');
    const type = value(row, 'type');
    const direction = value(row, 'direction');
    const fileName = `${transactionId}-${direction}-${type}.xml`;

    fs.writeFileSync(path.join(SCRIPT_DIR, fileName), buildMessage(row), 'utf8');
    console.log(`Generated ${fileName}`);
  });
}

try { main(); }
catch (err) { console.error(err.message); process.exitCode = 1; }
