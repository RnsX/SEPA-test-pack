'use strict';

// Zero-dependency SEPA pacs.008.001.08 generator.
// Uses only Node.js built-in modules (fs, path).
//
// Input: sepa-payments.csv in the same directory by default, or pass a CSV path:
//   node generate-sepa.js
//   node generate-sepa.js /path/to/another.csv
//
// One CSV row = one XML payment message.
// "payment type" must be exactly SCT or SCT INST.
// Output filename = <metadata id>-<metadata direction>-<metadata scheme>.xml
// and is always written to the directory containing this script.
//
// The CSV includes all pacs.008 payment-chain agent roles (Previous Instructing
// Agents 1-3, Instructing/Instructed, Intermediary Agents 1-3, Debtor/Creditor
// Agents and their applicable agent accounts). It also contains EPC inquiry /
// R-transaction / confirmation
// attributes. Those belong to other ISO 20022 messages (pacs.002, pacs.004,
// camt.056, camt.029, etc.) and are not inserted into the initial pacs.008.

const fs = require('fs');
const path = require('path');

const SCRIPT_DIR = __dirname;
const csvPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(SCRIPT_DIR, 'sepa-payments.csv');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  if (quoted) {
    throw new Error('CSV is malformed: unterminated quoted field.');
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return [];

  // Supports either:
  //   row 1 = machine-readable headers (legacy format), or
  //   row 1 = user-friendly labels, row 2 = ISO/XML paths, row 3 = machine-readable headers.
  let headerRowIndex = 0;
  const firstCell = String(rows[0]?.[0] ?? '').replace(/^\uFEFF/, '').trim();
  const thirdRowFirstCell = String(rows[2]?.[0] ?? '').replace(/^\uFEFF/, '').trim();
  if (firstCell !== 'metadata id' && thirdRowFirstCell === 'metadata id') {
    headerRowIndex = 2;
  }

  const headers = rows[headerRowIndex].map((h, index) => {
    const value = index === 0 ? h.replace(/^\uFEFF/, '') : h;
    return value.trim();
  });

  const duplicates = headers.filter((h, i) => headers.indexOf(h) !== i);
  if (duplicates.length) {
    throw new Error(`CSV contains duplicate headers: ${[...new Set(duplicates)].join(', ')}`);
  }

  const dataRows = rows.slice(headerRowIndex + 1);

  return dataRows
    .filter((cells) => cells.some((cell) => String(cell).trim() !== ''))
    .map((cells, rowIndex) => {
      const obj = { __rowNumber: rowIndex + headerRowIndex + 2 };
      for (let i = 0; i < headers.length; i += 1) {
        obj[headers[i]] = cells[i] === undefined ? '' : cells[i];
      }
      return obj;
    });
}

function value(row, key) {
  return String(row[key] ?? '').trim();
}

function xmlEscape(input) {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function safeFilePart(input, fieldName) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error(`${fieldName} is required for the output filename.`);
  const safe = raw.replace(/[^A-Za-z0-9._-]+/g, '_');
  if (!safe || safe === '.' || safe === '..') {
    throw new Error(`${fieldName} does not contain a usable filename value.`);
  }
  return safe;
}

function isIsoDate(valueToCheck) {
  return /^\d{4}-\d{2}-\d{2}$/.test(valueToCheck);
}

function isIsoDateTimeWithZone(valueToCheck) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(valueToCheck);
}

function isBic(valueToCheck) {
  return /^[A-Z0-9]{8}(?:[A-Z0-9]{3})?$/.test(valueToCheck);
}

function isIban(valueToCheck) {
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(valueToCheck.replace(/\s+/g, ''));
}

function add(lines, level, xml) {
  lines.push(`${'  '.repeat(level)}${xml}`);
}

function addText(lines, level, tagName, text) {
  const v = String(text ?? '').trim();
  if (v !== '') add(lines, level, `<${tagName}>${xmlEscape(v)}</${tagName}>`);
}

function addFinInst(lines, level, tagName, bic) {
  const v = String(bic ?? '').trim().toUpperCase();
  if (!v) return;
  add(lines, level, `<${tagName}>`);
  add(lines, level + 1, '<FinInstnId>');
  addText(lines, level + 2, 'BICFI', v);
  add(lines, level + 1, '</FinInstnId>');
  add(lines, level, `</${tagName}>`);
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
    if (type === 'ANYBIC') {
      addText(lines, level + 2, 'AnyBIC', id.toUpperCase());
    } else if (type === 'LEI') {
      addText(lines, level + 2, 'LEI', id.toUpperCase());
    } else {
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

function addPostalAddress(lines, level, row, kind, epcAddressColumn) {
  const street = value(row, `${kind} address street name`);
  const building = value(row, `${kind} address building number`);
  const postCode = value(row, `${kind} address post code`);
  const town = value(row, `${kind} address town name`);
  const country = value(row, `${kind} address country`).toUpperCase();
  const addressLine = value(row, epcAddressColumn);

  const hasAddress = street || building || postCode || town || country || addressLine;
  if (!hasAddress) return;

  add(lines, level, '<PstlAdr>');
  addText(lines, level + 1, 'StrtNm', street);
  addText(lines, level + 1, 'BldgNb', building);
  addText(lines, level + 1, 'PstCd', postCode);
  addText(lines, level + 1, 'TwnNm', town);
  addText(lines, level + 1, 'Ctry', country);

  // AdrLine together with structured Town/Country is a hybrid address.
  // This remains usable after the EPC unstructured-address phase-out.
  if (addressLine && town && country) {
    addText(lines, level + 1, 'AdrLine', addressLine);
  }
  add(lines, level, '</PstlAdr>');
}

function addParty(lines, level, tagName, name, row, options = {}) {
  const partyName = String(name ?? '').trim();
  const idCode = value(row, options.idColumn || '');
  const hasAddress = options.addressKind && (
    value(row, `${options.addressKind} address street name`) ||
    value(row, `${options.addressKind} address building number`) ||
    value(row, `${options.addressKind} address post code`) ||
    value(row, `${options.addressKind} address town name`) ||
    value(row, `${options.addressKind} address country`) ||
    value(row, options.addressColumn || '')
  );

  if (!partyName && !idCode && !hasAddress) return;

  add(lines, level, `<${tagName}>`);
  addText(lines, level + 1, 'Nm', partyName);

  if (options.addressKind) {
    addPostalAddress(lines, level + 1, row, options.addressKind, options.addressColumn);
  }

  if (idCode) {
    addPartyIdentification(
      lines,
      level + 1,
      idCode,
      value(row, options.idTypeColumn || ''),
      value(row, options.idSchemeColumn || '')
    );
  }

  add(lines, level, `</${tagName}>`);
}

function addAccount(lines, level, tagName, iban, proxy) {
  const cleanIban = String(iban ?? '').replace(/\s+/g, '').toUpperCase();
  const alias = String(proxy ?? '').trim();
  if (!cleanIban && !alias) return;

  add(lines, level, `<${tagName}>`);
  if (cleanIban) {
    add(lines, level + 1, '<Id>');
    addText(lines, level + 2, 'IBAN', cleanIban);
    add(lines, level + 1, '</Id>');
  }
  if (alias) {
    add(lines, level + 1, '<Prxy>');
    addText(lines, level + 2, 'Id', alias);
    add(lines, level + 1, '</Prxy>');
  }
  add(lines, level, `</${tagName}>`);
}

// Agent accounts use CashAccount38. The CSV supports either an IBAN or an
// ISO Other/Id value for each agent account; do not populate both on one row.
function addAgentAccount(lines, level, tagName, iban, otherId) {
  const cleanIban = String(iban ?? '').replace(/\s+/g, '').toUpperCase();
  const other = String(otherId ?? '').trim();
  if (!cleanIban && !other) return;

  add(lines, level, `<${tagName}>`);
  add(lines, level + 1, '<Id>');
  if (cleanIban) {
    addText(lines, level + 2, 'IBAN', cleanIban);
  } else {
    add(lines, level + 2, '<Othr>');
    addText(lines, level + 3, 'Id', other);
    add(lines, level + 2, '</Othr>');
  }
  add(lines, level + 1, '</Id>');
  add(lines, level, `</${tagName}>`);
}

function addCodeOrProprietary(lines, level, wrapperTag, input) {
  const v = String(input ?? '').trim();
  if (!v) return;
  add(lines, level, `<${wrapperTag}>`);
  if (/^[A-Z0-9]{4}$/.test(v)) {
    addText(lines, level + 1, 'Cd', v);
  } else {
    addText(lines, level + 1, 'Prtry', v);
  }
  add(lines, level, `</${wrapperTag}>`);
}

function addRemittance(lines, level, row) {
  const text = value(row, 'AT-T009 remittance information');
  if (!text) return;

  const mode = (value(row, 'remittance mode') || 'USTRD').toUpperCase();
  add(lines, level, '<RmtInf>');

  if (mode === 'SCOR') {
    add(lines, level + 1, '<Strd>');
    add(lines, level + 2, '<CdtrRefInf>');
    add(lines, level + 3, '<Tp>');
    add(lines, level + 4, '<CdOrPrtry>');
    addText(lines, level + 5, 'Cd', 'SCOR');
    add(lines, level + 4, '</CdOrPrtry>');
    addText(lines, level + 4, 'Issr', value(row, 'remittance issuer') || 'ISO');
    add(lines, level + 3, '</Tp>');
    addText(lines, level + 3, 'Ref', text);
    add(lines, level + 2, '</CdtrRefInf>');
    add(lines, level + 1, '</Strd>');
  } else {
    addText(lines, level + 1, 'Ustrd', text);
  }

  add(lines, level, '</RmtInf>');
}

function validateRow(row) {
  const errors = [];
  const type = value(row, 'payment type').toUpperCase();

  if (!['SCT', 'SCT INST'].includes(type)) {
    errors.push('"payment type" must be SCT or SCT INST');
  }

  const required = [
    'metadata id',
    'metadata direction',
    'metadata scheme',
    'message id',
    'creation datetime',
    'AT-P001 name of Originator',
    'AT-E001 name of Beneficiary',
    'AT-D001 IBAN of Originator account',
    'AT-D002 BIC of Originator PSP',
    'AT-C001 IBAN of Beneficiary account',
    'AT-C002 BIC of Beneficiary PSP',
    'AT-T002 amount in euro',
    'AT-T014 Originator reference',
    'AT-T051 settlement date',
    'AT-T054 Originator PSP reference'
  ];

  for (const key of required) {
    if (!value(row, key)) errors.push(`${key} is required`);
  }

  if (value(row, 'metadata scheme').toUpperCase() !== 'SEPA') {
    errors.push('metadata scheme must be SEPA for this generator');
  }

  if (value(row, 'creation datetime') && !isIsoDateTimeWithZone(value(row, 'creation datetime'))) {
    errors.push('creation datetime must be ISO 8601 with timezone, e.g. 2026-09-17T08:45:00+03:00');
  }

  if (value(row, 'AT-T051 settlement date') && !isIsoDate(value(row, 'AT-T051 settlement date'))) {
    errors.push('AT-T051 settlement date must be YYYY-MM-DD');
  }

  if (type === 'SCT INST') {
    if (!value(row, 'AT-T056 SCT Inst timestamp')) {
      errors.push('AT-T056 SCT Inst timestamp is required for SCT INST');
    } else if (!isIsoDateTimeWithZone(value(row, 'AT-T056 SCT Inst timestamp'))) {
      errors.push('AT-T056 SCT Inst timestamp must be ISO 8601 with timezone');
    }
  }

  const amount = value(row, 'AT-T002 amount in euro');
  if (amount && (!/^\d+(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0)) {
    errors.push('AT-T002 amount in euro must be a positive number with at most 2 decimals');
  }

  for (const key of ['AT-D001 IBAN of Originator account', 'AT-C001 IBAN of Beneficiary account']) {
    if (value(row, key) && !isIban(value(row, key))) errors.push(`${key} is not in IBAN format`);
  }

  const agentBicKeys = [
    'previous instructing agent 1 BIC',
    'previous instructing agent 2 BIC',
    'previous instructing agent 3 BIC',
    'instructing agent BIC',
    'instructed agent BIC',
    'intermediary agent 1 BIC',
    'intermediary agent 2 BIC',
    'intermediary agent 3 BIC',
    'AT-D002 BIC of Originator PSP',
    'AT-C002 BIC of Beneficiary PSP'
  ];
  for (const key of agentBicKeys) {
    if (value(row, key) && !isBic(value(row, key).toUpperCase())) errors.push(`${key} is not in BIC format`);
  }

  const agentAccounts = [
    ['previous instructing agent 1 account IBAN', 'previous instructing agent 1 account other id', 'previous instructing agent 1 BIC'],
    ['previous instructing agent 2 account IBAN', 'previous instructing agent 2 account other id', 'previous instructing agent 2 BIC'],
    ['previous instructing agent 3 account IBAN', 'previous instructing agent 3 account other id', 'previous instructing agent 3 BIC'],
    ['intermediary agent 1 account IBAN', 'intermediary agent 1 account other id', 'intermediary agent 1 BIC'],
    ['intermediary agent 2 account IBAN', 'intermediary agent 2 account other id', 'intermediary agent 2 BIC'],
    ['intermediary agent 3 account IBAN', 'intermediary agent 3 account other id', 'intermediary agent 3 BIC'],
    ['debtor agent account IBAN', 'debtor agent account other id', 'AT-D002 BIC of Originator PSP'],
    ['creditor agent account IBAN', 'creditor agent account other id', 'AT-C002 BIC of Beneficiary PSP']
  ];
  for (const [ibanKey, otherKey, agentKey] of agentAccounts) {
    const iban = value(row, ibanKey);
    const other = value(row, otherKey);
    if (iban && other) errors.push(`${ibanKey} and ${otherKey} are mutually exclusive`);
    if (iban && !isIban(iban)) errors.push(`${ibanKey} is not in IBAN format`);
    if ((iban || other) && !value(row, agentKey)) errors.push(`${agentKey} is required when an associated agent account is populated`);
  }

  return errors;
}

function buildPacs008(row) {
  const paymentType = value(row, 'payment type').toUpperCase();
  const isInstant = paymentType === 'SCT INST';
  const amount = value(row, 'AT-T002 amount in euro');
  const serviceLevel = (value(row, 'AT-T001 identification code of scheme') || 'SEPA').toUpperCase();
  const settlementMethod = (value(row, 'settlement method') || 'CLRG').toUpperCase();

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  add(lines, 0, '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08">');
  add(lines, 1, '<FIToFICstmrCdtTrf>');

  // Group Header
  add(lines, 2, '<GrpHdr>');
  addText(lines, 3, 'MsgId', value(row, 'message id'));
  addText(lines, 3, 'CreDtTm', value(row, 'creation datetime'));
  addText(lines, 3, 'NbOfTxs', '1');
  add(lines, 3, '<SttlmInf>');
  addText(lines, 4, 'SttlmMtd', settlementMethod);
  add(lines, 3, '</SttlmInf>');
  add(lines, 2, '</GrpHdr>');

  // Credit Transfer Transaction Information
  add(lines, 2, '<CdtTrfTxInf>');

  add(lines, 3, '<PmtId>');
  addText(lines, 4, 'InstrId', value(row, 'instruction id') || value(row, 'AT-T014 Originator reference'));
  addText(lines, 4, 'EndToEndId', value(row, 'AT-T014 Originator reference'));
  addText(lines, 4, 'TxId', value(row, 'AT-T054 Originator PSP reference'));
  addText(lines, 4, 'UETR', value(row, 'uetr'));
  add(lines, 3, '</PmtId>');

  add(lines, 3, '<PmtTpInf>');
  add(lines, 4, '<SvcLvl>');
  addText(lines, 5, 'Cd', serviceLevel);
  add(lines, 4, '</SvcLvl>');
  if (isInstant) {
    add(lines, 4, '<LclInstrm>');
    addText(lines, 5, 'Cd', 'INST');
    add(lines, 4, '</LclInstrm>');
  }
  addCodeOrProprietary(lines, 4, 'CtgyPurp', value(row, 'AT-T008 category purpose'));
  add(lines, 3, '</PmtTpInf>');

  add(lines, 3, `<IntrBkSttlmAmt Ccy="EUR">${xmlEscape(amount)}</IntrBkSttlmAmt>`);
  addText(lines, 3, 'IntrBkSttlmDt', value(row, 'AT-T051 settlement date'));
  if (isInstant) addText(lines, 3, 'AccptncDtTm', value(row, 'AT-T056 SCT Inst timestamp'));
  addText(lines, 3, 'ChrgBr', 'SLEV');

  // Optional payment-chain agents in ISO 20022 pacs.008 sequence.
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

  addParty(lines, 3, 'UltmtDbtr', value(row, 'AT-P006 name of Originator Reference Party'), row, {
    idColumn: 'AT-P007 identification code of Originator Reference Party',
    idTypeColumn: 'originator reference party identification type',
    idSchemeColumn: 'originator reference party identification scheme'
  });

  addParty(lines, 3, 'Dbtr', value(row, 'AT-P001 name of Originator'), row, {
    idColumn: 'AT-P004 Originator identification code',
    idTypeColumn: 'originator identification type',
    idSchemeColumn: 'originator identification scheme',
    addressKind: 'originator',
    addressColumn: 'AT-P005 address of Originator'
  });

  addAccount(
    lines,
    3,
    'DbtrAcct',
    value(row, 'AT-D001 IBAN of Originator account'),
    value(row, 'AT-P003 proxy alias of Originator account')
  );
  addFinInst(lines, 3, 'DbtrAgt', value(row, 'AT-D002 BIC of Originator PSP'));
  addAgentAccount(lines, 3, 'DbtrAgtAcct', value(row, 'debtor agent account IBAN'), value(row, 'debtor agent account other id'));
  addFinInst(lines, 3, 'CdtrAgt', value(row, 'AT-C002 BIC of Beneficiary PSP'));
  addAgentAccount(lines, 3, 'CdtrAgtAcct', value(row, 'creditor agent account IBAN'), value(row, 'creditor agent account other id'));

  addParty(lines, 3, 'Cdtr', value(row, 'AT-E001 name of Beneficiary'), row, {
    idColumn: 'AT-E005 Beneficiary identification code',
    idTypeColumn: 'beneficiary identification type',
    idSchemeColumn: 'beneficiary identification scheme',
    addressKind: 'beneficiary',
    addressColumn: 'AT-E004 address of Beneficiary'
  });

  addAccount(
    lines,
    3,
    'CdtrAcct',
    value(row, 'AT-C001 IBAN of Beneficiary account'),
    value(row, 'AT-E003 proxy alias of Beneficiary account')
  );

  addParty(lines, 3, 'UltmtCdtr', value(row, 'AT-E007 name of Beneficiary Reference Party'), row, {
    idColumn: 'AT-E010 identification code of Beneficiary Reference Party',
    idTypeColumn: 'beneficiary reference party identification type',
    idSchemeColumn: 'beneficiary reference party identification scheme'
  });

  addCodeOrProprietary(lines, 3, 'Purp', value(row, 'AT-T007 purpose of transfer'));
  addRemittance(lines, 3, row);

  add(lines, 2, '</CdtTrfTxInf>');
  add(lines, 1, '</FIToFICstmrCdtTrf>');
  add(lines, 0, '</Document>');

  return `${lines.join('\n')}\n`;
}

function main() {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }

  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  if (!rows.length) {
    throw new Error('CSV has no data rows.');
  }

  let generated = 0;
  const failed = [];

  for (const row of rows) {
    try {
      const validationErrors = validateRow(row);
      if (validationErrors.length) {
        throw new Error(validationErrors.join('; '));
      }

      const fileName = [
        safeFilePart(value(row, 'metadata id'), 'metadata id'),
        safeFilePart(value(row, 'metadata direction'), 'metadata direction'),
        safeFilePart(value(row, 'metadata scheme'), 'metadata scheme')
      ].join('-') + '.xml';

      const outputPath = path.join(SCRIPT_DIR, fileName);
      fs.writeFileSync(outputPath, buildPacs008(row), 'utf8');
      console.log(`Generated: ${outputPath}`);
      generated += 1;
    } catch (error) {
      failed.push(`Row ${row.__rowNumber}: ${error.message}`);
    }
  }

  console.log(`\nGenerated ${generated} XML file(s).`);
  if (failed.length) {
    console.error(`Failed ${failed.length} row(s):`);
    for (const message of failed) console.error(`- ${message}`);
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
