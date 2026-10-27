import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPatch } from './netlify/functions/sync-merge.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.csv':'text/csv; charset=utf-8', '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json; charset=utf-8' };
let data = {
  headers: ['SLNo','OfficeID','OfficeCode','OfficeName','EmpName','CenterCode','CenterName','MemberCode','MemberName','ProductCode','ProductName','MainProductCode','MainItemName','EmployeeCode','PhoneNo','DisburseDate','PrincipalLoan','Duration','MonthPassed','LBalance','SCBalance','InstallmentStartDate','InstallmentAmount','InstallmentDateActual','InstallmentActual','Remarks','LoanSummaryID','IntCharge','NoOfFullPayement','NoOfPartialPayement','NoOfNotPayement'],
  rows: [
    ['1','35','14','GOBRA BRANCH','MD. MONIRUL ISLAM','001','0001, GOBRA BAZAR','1405808','Md Rakib Hasan','30.03','30.03, Agrasor-MFCE-1.5Yrs/M','1086','Agrasor-MFCE Loan','1994','01711000001','4/5/2026','350000','18','4','272232','39478','4/10/2026','22260','','0','','552038','3368.87','0','0','1'],
    ['2','35','14','GOBRA BRANCH','AZAZ SAKIB','156','0156, AGDIA','1405795','Mrs Munjila Khatun','30.03','30.03, Agrasor-MFCE-1.5Yrs/M','1086','Agrasor-MFCE Loan','1994','01711000002','4/5/2026','350000','18','4','272232','39478','4/10/2026','22260','','500','','552038','3368.87','0','1','1'],
    ['3','35','42','GOBRA BRANCH','MD. MINTU MOHALDER','042','0042, MALOPARA','1404896','Mamtaj Begum','2.04','02.04, Agra1.5Y/M','1189','Agrosor Loan','1189','01711000003','3/8/2026','200000','18','1','188888','37778','4/10/2026','13334','6/10/2026','13334','','557878','3148.13','1','0','0'],
    ['4','35','14','GOBRA BRANCH','MD. ALOMGIR HOSSAIN','145','0145, BICHALI','1405426','Md. Riaz Hossain','30.03','30.03, Agrasor-MFCE-1.5Yrs/M','1086','Agrasor-MFCE Loan','1994','01711000004','4/5/2026','350000','18','4','272232','39478','4/10/2026','22260','','0','','552038','3368.87','0','0','1'],
    ['5','35','70','GOBRA BRANCH','AZAZ SAKIB','070','0070, SHOL PUR','1401992','Tapon Biswash','30.03','30.03, Agrasor-MFCE-1.5Yrs/M','1086','Agrasor-MFCE Loan','1994','01711000005','4/5/2026','350000','18','4','272232','39478','4/10/2026','22260','','0','','552038','3368.87','0','0','1']
  ],
  collections: [{ id:'demo-col-1', installmentKey:'demo-row-3', date:'2026-10-19', createdAt:new Date().toISOString(), memberCode:'001403521', memberName:'Nasima Begum', mobile:'01912000004', loan:900, savings:100, dps:0, total:1000, memberDetails:[{label:'Center Code',value:'0017'}] }],
  followups: [],
  dailyData: {
    memberDBHeaders:['Sl. No.','','Center Code & Name','Member No','','Member Name','','Contact Number','Father / Husband / Care Of','Age','Joining Date','','Pre Member Code','','','Drop Out Date','Status','Member Type','',''],
    memberDB:[
      ['1','','0001, GOBRA BAZAR','001405808','','Md Rakib Hasan','','01711000001','Abdul Karim','38','05-Feb-2015','','','','','Active','Member','',''],
      ['2','','0156, AGDIA','001405795','','Mrs Munjila Khatun','','01711000002','Md Jahir Molla','45','12-Jan-2018','','','','','Active','Member','',''],
      ['3','','0042, MALOPARA','001404896','','Mamtaj Begum','','01711000003','Md. Hannan','32','19-Jun-2019','','','','','Active','Member','',''],
      ['4','','0145, BICHALI','001405426','','Md. Riaz Hossain','','01711000004','Abdul Malek','41','08-Apr-2017','','','','','Active','Member','',''],
      ['5','','0070, SHOL PUR','001401992','','Tapon Biswash','','01711000005','Sudhir Das','29','22-Sep-2020','','','','','Active','Member','','']
    ],
    balanceHeaders:['Member ID','Name of Member','Loan Outstanding','Savings Outstanding'],
    balanceRows:[
      ['001405808','Md Rakib Hasan','85000','12500','001'],
      ['001405795','Mrs Munjila Khatun','220000','34000','156'],
      ['001404896','Mamtaj Begum','188888','37778','042'],
      ['001405426','Md. Riaz Hossain','272232','39478','145'],
      ['001401992','Tapon Biswash','96000','18500','070']
    ],
    todayRows:[],
    paidArchive:[]
  }
};
// preview-data.json থাকলে চালু হওয়ার সময় সেটিই শেয়ার্ড ডেটা হিসেবে লোড হয় (রিস্টার্টেও ডেটা টেকে)
try {
  const seed = JSON.parse(await readFile(path.join(root, 'preview-data.json'), 'utf8'));
  if (seed && Array.isArray(seed.rows)) { data = seed; console.log(`Seeded preview-data.json - ${seed.rows.length} rows`); }
} catch { /* সিড ফাইল নেই — ডেমো ডেটাই থাকবে */ }

function summarize(doc) {
  const d = doc?.dailyData || {};
  const n = (v) => (Array.isArray(v) ? v.length : 0);
  return { updated_at: doc?.updated_at || new Date().toISOString(), counts: { rows:n(doc?.rows), members:n(d.memberDB), balances:n(d.balanceRows), today:n(d.todayRows), collections:n(doc?.collections), followups:n(doc?.followups), history:n(doc?.history), paidArchive:n(d.paidArchive) } };
}
const server = http.createServer(async (req,res) => {
  if (req.url.startsWith('/api/data')) {
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.searchParams.get('meta') === '1') { res.end(JSON.stringify(summarize(data))); return; }
    if (req.method === 'GET') { res.end(JSON.stringify(data)); return; }
    if (req.method === 'POST') {
      let body=''; for await (const chunk of req) body += chunk;
      try {
        const parsed = JSON.parse(body);
        if (!parsed?.patch) { res.statusCode=400; res.end(JSON.stringify({error:'Expected { patch }'})); return; }
        data = applyPatch(data, parsed.patch);
        data.updated_at = new Date().toISOString();
        res.end(JSON.stringify({ ok:true, ...summarize(data) }));
      } catch { res.statusCode=400; res.end(JSON.stringify({error:'Invalid JSON'})); }
      return;
    }
    if (req.method === 'PUT') {
      let body=''; for await (const chunk of req) body += chunk;
      try { data = JSON.parse(body); res.end(JSON.stringify(data)); }
      catch { res.statusCode=400; res.end(JSON.stringify({error:'Invalid JSON'})); }
      return;
    }
    res.statusCode=405; res.end(JSON.stringify({error:'Method not allowed'})); return;
  }
  const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(root,relative);
  if (!file.startsWith(root + path.sep) && file !== path.join(root,'index.html')) { res.statusCode=403; res.end('Forbidden'); return; }
  try { const body=await readFile(file); res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream'); res.setHeader('Cache-Control','no-store, max-age=0'); res.end(body); }
  catch { res.statusCode=404; res.end('Not found'); }
});
server.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('Sandbox running with an in-memory demo API (no Neon writes).'));
