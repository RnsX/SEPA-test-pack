'use strict';

// Zero-dependency ISO 20022 party/agent/payment-details XML fragment generator.
// Uses only Node.js built-ins (fs, path).
//
// Deliberately NOT a complete SEPA/pacs.008 payment message:
// - no scheme/payment type
// - no group header / message metadata
// - no instruction/UETR/transaction/status identifiers
// - no settlement metadata / charge bearer / lifecycle data
//
// Input CSV format:
//   row 1 = user-friendly field names
//   row 2 = XML paths/tags
//   row 3 = machine-readable field names used by this script
//   row 4+ = data
//
// Output: payment-001.xml, payment-002.xml, ... in the script directory.

const fs = require('fs');
const path = require('path');

const SCRIPT_DIR = __dirname;
const csvPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(SCRIPT_DIR, 'party-agent-narrative.csv');

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

  if (quoted) throw new Error('CSV is malformed: unterminated quoted field.');
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  if (rows.length < 3) throw new Error('CSV must contain the 3 descriptive/header rows.');

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
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function add(lines, level, xml) { lines.push(`${'  '.repeat(level)}${xml}`); }
function addText(lines, level, tag, v) {
  const x = String(v ?? '').trim();
  if (x !== '') add(lines, level, `<${tag}>${xmlEscape(x)}</${tag}>`);
}

function addFinInst(lines, level, tag, bic) {
  const v = String(bic ?? '').trim();
  if (!v) return;
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
  addText(lines, level + 2, 'IBAN', i);
  if (o) {
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
  const type = String(idType ?? 'ORG_OTHER').trim().toUpperCase();
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
  const fields = {
    StrtNm: value(row, `${prefix} address street name`),
    BldgNb: value(row, `${prefix} address building number`),
    PstCd: value(row, `${prefix} address post code`),
    TwnNm: value(row, `${prefix} address town name`),
    Ctry: value(row, `${prefix} address country`),
    AdrLine: value(row, `${prefix} address line`)
  };
  if (!Object.values(fields).some(Boolean)) return;
  add(lines, level, '<PstlAdr>');
  for (const [tag, v] of Object.entries(fields)) addText(lines, level + 1, tag, v);
  add(lines, level, '</PstlAdr>');
}

function addParty(lines, level, tag, row, prefix) {
  const name = value(row, `${prefix} name`);
  const id = value(row, `${prefix} identification code`);
  const countryOfResidence = value(row, `${prefix} country of residence`);
  const hasAddress = [
    'address street name','address building number','address post code','address town name','address country','address line'
  ].some(s => value(row, `${prefix} ${s}`));
  if (!name && !id && !countryOfResidence && !hasAddress) return;

  add(lines, level, `<${tag}>`);
  addText(lines, level + 1, 'Nm', name);
  addPostalAddress(lines, level + 1, row, prefix);
  addPartyIdentification(
    lines, level + 1, id,
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
  if (/^[A-Z0-9]{4}$/.test(v)) addText(lines, level + 1, 'Cd', v);
  else addText(lines, level + 1, 'Prtry', v);
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
  } else addText(lines, level + 1, 'Ustrd', narrative);
  add(lines, level, '</RmtInf>');
}

function buildFragment(row) {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
  add(lines, 0, '<CdtTrfTxInf xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08">');

  const amount = value(row, 'payment amount');
  if (amount) {
    const ccy = value(row, 'payment currency');
    const attr = ccy ? ` Ccy="${xmlEscape(ccy)}"` : '';
    add(lines, 1, `<IntrBkSttlmAmt${attr}>${xmlEscape(amount)}</IntrBkSttlmAmt>`);
  }

  addFinInst(lines, 1, 'PrvsInstgAgt1', value(row, 'previous instructing agent 1 BIC'));
  addAgentAccount(lines, 1, 'PrvsInstgAgt1Acct', value(row, 'previous instructing agent 1 account IBAN'), value(row, 'previous instructing agent 1 account other id'));
  addFinInst(lines, 1, 'PrvsInstgAgt2', value(row, 'previous instructing agent 2 BIC'));
  addAgentAccount(lines, 1, 'PrvsInstgAgt2Acct', value(row, 'previous instructing agent 2 account IBAN'), value(row, 'previous instructing agent 2 account other id'));
  addFinInst(lines, 1, 'PrvsInstgAgt3', value(row, 'previous instructing agent 3 BIC'));
  addAgentAccount(lines, 1, 'PrvsInstgAgt3Acct', value(row, 'previous instructing agent 3 account IBAN'), value(row, 'previous instructing agent 3 account other id'));
  addFinInst(lines, 1, 'InstgAgt', value(row, 'instructing agent BIC'));
  addFinInst(lines, 1, 'InstdAgt', value(row, 'instructed agent BIC'));
  addFinInst(lines, 1, 'IntrmyAgt1', value(row, 'intermediary agent 1 BIC'));
  addAgentAccount(lines, 1, 'IntrmyAgt1Acct', value(row, 'intermediary agent 1 account IBAN'), value(row, 'intermediary agent 1 account other id'));
  addFinInst(lines, 1, 'IntrmyAgt2', value(row, 'intermediary agent 2 BIC'));
  addAgentAccount(lines, 1, 'IntrmyAgt2Acct', value(row, 'intermediary agent 2 account IBAN'), value(row, 'intermediary agent 2 account other id'));
  addFinInst(lines, 1, 'IntrmyAgt3', value(row, 'intermediary agent 3 BIC'));
  addAgentAccount(lines, 1, 'IntrmyAgt3Acct', value(row, 'intermediary agent 3 account IBAN'), value(row, 'intermediary agent 3 account other id'));

  addParty(lines, 1, 'UltmtDbtr', row, 'ultimate debtor');
  addParty(lines, 1, 'Dbtr', row, 'debtor');
  addAccount(lines, 1, 'DbtrAcct', value(row, 'debtor account IBAN'), value(row, 'debtor account proxy alias'));
  addFinInst(lines, 1, 'DbtrAgt', value(row, 'debtor agent BIC'));
  addAgentAccount(lines, 1, 'DbtrAgtAcct', value(row, 'debtor agent account IBAN'), value(row, 'debtor agent account other id'));
  addFinInst(lines, 1, 'CdtrAgt', value(row, 'creditor agent BIC'));
  addAgentAccount(lines, 1, 'CdtrAgtAcct', value(row, 'creditor agent account IBAN'), value(row, 'creditor agent account other id'));
  addParty(lines, 1, 'Cdtr', row, 'creditor');
  addAccount(lines, 1, 'CdtrAcct', value(row, 'creditor account IBAN'), value(row, 'creditor account proxy alias'));
  addParty(lines, 1, 'UltmtCdtr', row, 'ultimate creditor');

  addPurpose(lines, 1, value(row, 'payment purpose'));
  addRemittance(lines, 1, row);

  add(lines, 0, '</CdtTrfTxInf>');
  return `${lines.join('\n')}\n`;
}

function main() {
  if (!fs.existsSync(csvPath)) throw new Error(`CSV file not found: ${csvPath}`);
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  if (!rows.length) throw new Error('CSV has no data rows.');

  rows.forEach((row, idx) => {
    const fileName = `payment-${String(idx + 1).padStart(3, '0')}.xml`;
    fs.writeFileSync(path.join(SCRIPT_DIR, fileName), buildFragment(row), 'utf8');
    console.log(`Generated ${fileName}`);
  });
}

try { main(); }
catch (err) { console.error(err.message); process.exitCode = 1; }
