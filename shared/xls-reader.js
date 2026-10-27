/* ============================================================
   ছোট ও নির্ভরতাবিহীন .xls (BIFF8 / OLE2) পাঠক
   — gBanker-এর "Members Profile" রিপোর্ট লেগ্য .xls (Compound File) ফাইল
     আসে; কোনো বাড়তি npm প্যাকেজ ও কোনো Node-এর নির্ভরতা ছাড়াই (শুধু
     Uint8Array/DataView) সেটি পড়ে টেবিলে রূপান্তর করে।
   — ব্রাউজার ও Node দুই জায়গাতেই চলে।
   ব্যবহার: readWorkbook(bytes) → { sheets: [{ name, rows }] }
   ============================================================ */
(function (root) {
  const ENDOFCHAIN = 0xFFFFFFFE;

  /* ---------- সহায়ক (Buffer ছাড়া) ---------- */
  const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  function concat(chunks) {
    let total = 0;
    chunks.forEach((c) => { total += c.length; });
    const out = new Uint8Array(total);
    let offset = 0;
    chunks.forEach((c) => { out.set(c, offset); offset += c.length; });
    return out;
  }
  function latin1(bytes, start, end) {
    let s = '';
    const chunk = 4096;
    for (let i = start; i < end; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(end, i + chunk)));
    }
    return s;
  }
  function utf16le(bytes, start, end) {
    let s = '';
    const chunk = 2048;
    for (let i = start; i + 1 < end; i += chunk * 2) {
      const stop = Math.min(end, i + chunk * 2);
      const codes = [];
      for (let j = i; j + 1 < stop; j += 2) codes.push(bytes[j] | (bytes[j + 1] << 8));
      s += String.fromCharCode.apply(null, codes);
    }
    return s;
  }
  const toBytes = (input) => {
    if (input instanceof Uint8Array) return input;
    if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) return new Uint8Array(input);
    if (input && input.buffer instanceof ArrayBuffer) return new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength);
    return new Uint8Array(0);
  };

  /* ---------- OLE2 (Compound File Binary) ---------- */
  function readOle2(bytes) {
    const data = toBytes(bytes);
    if (data.length < 512) throw new Error('ফাইল ছোট।');
    const dv = view(data);
    if (dv.getUint32(0, true) !== 0xE011CFD0) throw new Error('OLE2 ফাইল নয়।');
    const sectorShift = dv.getUint16(0x1E, true);
    const miniSectorShift = dv.getUint16(0x20, true);
    const sectorSize = 1 << sectorShift;
    const miniSectorSize = 1 << miniSectorShift;
    const firstDirSector = dv.getUint32(0x30, true);
    const miniCutoff = dv.getUint32(0x38, true) || 4096;
    const firstMiniFat = dv.getUint32(0x3C, true);

    const sectorOffset = (id) => (id + 1) * sectorSize;
    const readSector = (id) => data.subarray(sectorOffset(id), sectorOffset(id) + sectorSize);

    /* DIFAT → FAT */
    const difat = [];
    for (let i = 0; i < 109; i++) {
      const value = dv.getUint32(0x4C + i * 4, true);
      if (value === 0xFFFFFFFF) break;
      difat.push(value);
    }
    let difatSector = dv.getUint32(0x44, true);
    let guard = 0;
    while (difatSector !== ENDOFCHAIN && difatSector !== 0xFFFFFFFF && guard++ < 10000) {
      const sector = readSector(difatSector);
      const count = Math.floor(sectorSize / 4) - 1;
      for (let i = 0; i < count; i++) difat.push(view(sector).getUint32(i * 4, true));
      difatSector = view(sector).getUint32(count * 4, true);
    }

    const fat = [];
    difat.forEach((fatSector) => {
      if (fatSector === 0xFFFFFFFF || fatSector === ENDOFCHAIN) return;
      const sector = readSector(fatSector);
      const sv = view(sector);
      for (let i = 0; i < sectorSize / 4; i++) fat.push(sv.getUint32(i * 4, true));
    });

    const chain = (start) => {
      const out = [];
      let id = start;
      let g = 0;
      while (id !== ENDOFCHAIN && id !== 0xFFFFFFFF && id < fat.length && g++ < 1000000) {
        out.push(id);
        id = fat[id];
      }
      return out;
    };
    const readChain = (start, size) => {
      const all = concat(chain(start).map((id) => readSector(id)));
      return size ? all.subarray(0, size) : all;
    };

    /* ডিরেক্টরি */
    const dirBytes = readChain(firstDirSector, 0);
    const entries = [];
    for (let offset = 0; offset + 128 <= dirBytes.length; offset += 128) {
      const entry = dirBytes.subarray(offset, offset + 128);
      const nameLen = view(entry).getUint16(64, true);
      const type = entry[66];
      if (!type) continue;
      const name = utf16le(entry, 0, Math.max(0, Math.min(64, nameLen) - 2));
      const startSector = view(entry).getUint32(116, true);
      const size = Number(view(entry).getBigUint64(120, true));
      entries.push({ name, type, startSector, size });
    }
    const rootEntry = entries.find((e) => e.type === 5) || entries[0];

    /* মিনি স্ট্রিম */
    const miniStream = rootEntry ? readChain(rootEntry.startSector, rootEntry.size) : new Uint8Array(0);
    const miniFatBytes = (firstMiniFat !== ENDOFCHAIN && firstMiniFat !== 0xFFFFFFFF) ? readChain(firstMiniFat, 0) : new Uint8Array(0);
    const miniFat = [];
    for (let i = 0; i + 4 <= miniFatBytes.length; i += 4) miniFat.push(view(miniFatBytes).getUint32(i, true));
    const readMiniChain = (start, size) => {
      const parts = [];
      let id = start;
      let g = 0;
      while (id !== ENDOFCHAIN && id !== 0xFFFFFFFF && g++ < 100000) {
        parts.push(miniStream.subarray(id * miniSectorSize, (id + 1) * miniSectorSize));
        id = miniFat[id];
      }
      const all = concat(parts);
      return size ? all.subarray(0, size) : all;
    };

    const streams = {};
    entries.filter((e) => e.type === 2).forEach((entry) => {
      streams[entry.name] = entry.size < miniCutoff
        ? readMiniChain(entry.startSector, entry.size)
        : readChain(entry.startSector, entry.size);
    });
    return streams;
  }

  /* ---------- BIFF8 ---------- */
  function rkValue(raw) {
    const cents = raw & 0x02;
    const isInt = raw & 0x01;
    let result;
    if (isInt) {
      result = raw >> 2;
      if (result & 0x20000000) result |= ~0x3fffffff;      // ৩০-বিট সাইন এক্সটেন্ড
    } else {
      const buf = new ArrayBuffer(8);
      const dv = new DataView(buf);
      dv.setInt32(4, raw & 0xfffffffc, true);
      result = dv.getFloat64(0, true);
    }
    return cents ? result / 100 : result;
  }

  /* SST — খণ্ডিত স্ট্রিং ও CONTINUE রেকর্ড সামলানো */
  function parseSst(segments) {
    const strings = [];
    if (!segments.length) return strings;
    let segIndex = 0;
    let segPos = 8;                                   // মোট ও ইউনিক সংখ্যার পরে
    const unique = (function () {
      const dv = view(segments[0]);
      return dv.getUint32(4, true);
    })();
    const readByte = () => {
      while (segIndex < segments.length && segPos >= segments[segIndex].length) { segIndex++; segPos = 0; }
      if (segIndex >= segments.length) return 0;
      return segments[segIndex][segPos++];
    };
    const readUInt16 = () => { const a = readByte(); const b = readByte(); return (b << 8) | a; };
    const readUInt32 = () => { const a = readUInt16(); const b = readUInt16(); return (b * 65536) + a; };

    for (let i = 0; i < unique; i++) {
      const cch = readUInt16();
      let grbit = readByte();
      let highByte = grbit & 0x01;
      let skip = 0;
      if (grbit & 0x08) { const cRun = readUInt16(); skip += cRun * 4; }   // rich text
      if (grbit & 0x04) { const cbExtRst = readUInt32(); skip += cbExtRst; }
      let text = '';
      let read = 0;
      while (read < cch) {
        if (segIndex >= segments.length) break;
        if (segPos >= segments[segIndex].length) {
          // স্ট্রিং চলমান অবস্থায় পরের CONTINUE রেকর্ড — প্রথম বাইট = নতুন option flags
          segIndex++; segPos = 0;
          if (segIndex >= segments.length) break;
          grbit = segments[segIndex][segPos++];
          highByte = grbit & 0x01;
          continue;
        }
        const buffer = segments[segIndex];
        const avail = buffer.length - segPos;
        if (avail <= 0) break;
        const width = highByte ? 2 : 1;
        let canRead = Math.min(cch - read, Math.floor(avail / width));
        if (canRead <= 0) {
          segIndex++; segPos = 0;
          if (segIndex >= segments.length) break;
          grbit = segments[segIndex][segPos++];
          highByte = grbit & 0x01;
          continue;
        }
        text += highByte ? utf16le(buffer, segPos, segPos + canRead * 2) : latin1(buffer, segPos, segPos + canRead);
        segPos += canRead * width;
        read += canRead;
      }
      if (skip > 0) {
        let left = skip;
        while (left > 0) {
          while (segIndex < segments.length && segPos >= segments[segIndex].length) { segIndex++; segPos = 0; }
          if (segIndex >= segments.length) break;
          const take = Math.min(left, segments[segIndex].length - segPos);
          segPos += take; left -= take;
        }
      }
      strings.push(text);
    }
    return strings;
  }

  function readWorkbook(input) {
    const bytes = toBytes(input);
    let workbook = null;
    try {
      const streams = readOle2(bytes);
      workbook = streams.Workbook || streams.Book || streams.WORKBOOK || null;
    } catch { workbook = null; }
    if (!workbook) workbook = bytes;
    const dv = view(workbook);
    const records = [];
    let pos = 0;
    while (pos + 4 <= workbook.length) {
      const type = dv.getUint16(pos, true);
      const length = dv.getUint16(pos + 2, true);
      records.push({ type, data: workbook.subarray(pos + 4, pos + 4 + length), pos });
      pos += 4 + length;
    }
    /* BOUNDSHEET — শিটের নাম ও অবস্থান */
    const bounds = [];
    records.forEach((rec) => {
      if (rec.type !== 0x0085 || rec.data.length < 10) return;
      const rv = view(rec.data);
      const sheetPos = rv.getUint32(0, true);
      let p = 6;
      const flags = rec.data[p]; p += 1;
      const cch = rec.data[p]; p += 1;
      let name;
      if (flags & 0x01) { name = utf16le(rec.data, p, p + cch * 2); p += cch * 2; }
      else { name = latin1(rec.data, p, p + cch); p += cch; }
      bounds.push({ name, pos: sheetPos });
    });
    /* SST (+CONTINUE) */
    let sst = [];
    const sstIndex = records.findIndex((rec) => rec.type === 0x00FC);
    if (sstIndex >= 0) {
      const segments = [records[sstIndex].data];
      for (let i = sstIndex + 1; i < records.length && records[i].type === 0x003C; i++) segments.push(records[i].data);
      sst = parseSst(segments);
    }
    /* শিট পড়া */
    const sheetStarts = bounds.map((b) => b.pos).filter((p) => p > 0).sort((a, b) => a - b);
    const readSheet = (startPos, endPos) => {
      const rowsMap = new Map();
      let pendingFormula = null;
      for (const rec of records) {
        if (rec.pos < startPos) continue;
        if (endPos && rec.pos >= endPos) break;
        const d = rec.data;
        const dv2 = view(d);
        switch (rec.type) {
          case 0x0203: {           // NUMBER
            const row = dv2.getUint16(0, true), col = dv2.getUint16(2, true);
            if (!rowsMap.has(row)) rowsMap.set(row, []);
            rowsMap.get(row)[col] = dv2.getFloat64(6, true);
            break;
          }
          case 0x027E: {           // RK
            const row = dv2.getUint16(0, true), col = dv2.getUint16(2, true);
            if (!rowsMap.has(row)) rowsMap.set(row, []);
            rowsMap.get(row)[col] = rkValue(dv2.getInt32(6, true));
            break;
          }
          case 0x00BD: {           // MULRK
            const row = dv2.getUint16(0, true), colFirst = dv2.getUint16(2, true);
            const count = Math.floor((d.length - 6) / 6);
            if (!rowsMap.has(row)) rowsMap.set(row, []);
            for (let i = 0; i < count; i++) rowsMap.get(row)[colFirst + i] = rkValue(dv2.getInt32(4 + i * 6 + 2, true));
            break;
          }
          case 0x00FD: {           // LABELSST
            const row = dv2.getUint16(0, true), col = dv2.getUint16(2, true);
            const index = dv2.getUint32(6, true);
            if (!rowsMap.has(row)) rowsMap.set(row, []);
            rowsMap.get(row)[col] = sst[index] !== undefined ? sst[index] : '';
            break;
          }
          case 0x0204: {           // LABEL
            const row = dv2.getUint16(0, true), col = dv2.getUint16(2, true);
            const cch = dv2.getUint16(6, true);
            const flags = d[8];
            const high = flags & 0x01;
            const text = high ? utf16le(d, 9, 9 + cch * 2) : latin1(d, 9, 9 + cch);
            if (!rowsMap.has(row)) rowsMap.set(row, []);
            rowsMap.get(row)[col] = text;
            break;
          }
          case 0x0205: {           // BOOLERR
            const row = dv2.getUint16(0, true), col = dv2.getUint16(2, true);
            const value = d[6], isError = d[7];
            if (!rowsMap.has(row)) rowsMap.set(row, []);
            rowsMap.get(row)[col] = isError ? null : (value ? true : false);
            break;
          }
          case 0x0006: {           // FORMULA
            const row = dv2.getUint16(0, true), col = dv2.getUint16(2, true);
            if (!rowsMap.has(row)) rowsMap.set(row, []);
            const flag = dv2.getUint16(14, true);
            if (flag === 0x0003) pendingFormula = { row, col };
            else if (flag === 0x0002) rowsMap.get(row)[col] = false;
            else if (flag === 0x000E) rowsMap.get(row)[col] = null;
            else rowsMap.get(row)[col] = dv2.getFloat64(6, true);
            break;
          }
          case 0x0207: {           // STRING (আগের ফর্মুলার স্ট্রিং)
            if (pendingFormula) {
              const cch = dv2.getUint16(0, true);
              const flags = d[2];
              const high = flags & 0x01;
              const text = high ? utf16le(d, 3, 3 + cch * 2) : latin1(d, 3, 3 + cch);
              if (rowsMap.has(pendingFormula.row)) rowsMap.get(pendingFormula.row)[pendingFormula.col] = text;
              pendingFormula = null;
            }
            break;
          }
          default: break;
        }
      }
      let maxRow = -1;
      rowsMap.forEach((_, key) => { if (key > maxRow) maxRow = key; });
      const rows = [];
      for (let r = 0; r <= maxRow; r++) {
        const arr = rowsMap.get(r) || [];
        const width = arr.length;
        rows.push(Array.from({ length: width }, (_, i) => {
          const value = arr[i];
          if (value === undefined || value === null) return '';
          if (typeof value === 'number') return String(value);
          if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
          return String(value);
        }));
      }
      return rows;
    };
    const sheets = bounds.map((bound, index) => ({
      name: bound.name,
      rows: readSheet(bound.pos, sheetStarts[index + 1] || Infinity),
    }));
    return { sheets };
  }

  root.COLLECTION_XLS = { readWorkbook };
})(typeof globalThis !== 'undefined' ? globalThis : this);
