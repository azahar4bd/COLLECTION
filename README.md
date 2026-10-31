# 💰 কালেকশন ম্যানেজার

CSV আপলোড করে কিস্তির ডাটা **বাকী · আদায় · আংশিক**—এই তিন ভাগে দেখা, ফিল্টার করা ও সংরক্ষণ করার ছোট্ট অ্যাপ। অ্যাপটি ভ্যানিলা HTML/CSS/JavaScript; Neon চালাতে serverless function যোগ করা হয়েছে।

## ফিচার

- **👥 নিচে ২টি প্রধান পেজ** (v9.48) — fixed bottom navigation-এ **Member List** ও **Today Collection**। Member List-এর dropdown থেকে আজ প্রতিশ্রুতি, আজ আদায়যোগ্য, বাকী, আদায়, আংশিক, অন্যান্য সদস্য ও স্থায়ী আদায় আর্কাইভ নির্বাচন করা যায়; সব তালিকা পরপর দেখার option-ও আছে। শেষ তালিকা মনে থাকে, Today-এর form/entries/Close/Undo/হিসাবের খাতা এবং details→আদায়→Return অপরিবর্তিত।
- **⌨️ Member code ঘরে auto লেখা নেই** (v9.47) — Today-এর মেম্বার কোড ঘরে typing, change বা blur-এ input আর rewrite হয় না; ব্যবহারকারীর লেখা code অক্ষরে-অক্ষরে থাকে। স্পষ্টভাবে suggestion/details/edit বেছে নিলে prefill আগের মতোই কাজ করে। মোট ঘরের auto-হিসাব ও financial rules অপরিবর্তিত।
- **⌨️ Member code টাইপ নিরাপদ** (v9.46) — Today-এর মেম্বার কোড ঘরে টাইপ চলাকালে partial suffix match আর input বদলায় না; পূর্ণ code মিললে নাম/সেন্টার আসে, change/blur-এ মূল code সংক্ষিপ্ত রূপে দেখায়। আগের matched code-এর পরে অতিরিক্ত সংখ্যা লিখলে পুরোনো নাম/center লেগে থাকে না। Suggestion, সঠিক সদস্য নির্বাচন ও saved financial data অপরিবর্তিত।
- **📚 Close batch-এ পুরো Today format** (v9.45) — হিসাবের খাতায় প্রতিটি Close batch আলাদা card-এ Today-এর মতোই **মাসিক আদায়, অন্যান্য আদায়, center subtotal, staff-wise tables, সকল স্টাফ সর্বমোট ও মাসিক+অন্যান্য summary** দেখায়। Entry row-এ একই columns ও edit/delete; তারিখ filter, roles, Undo এবং Neon data অপরিবর্তিত।
- **↩️ হিসাব ক্লোজ + আনডো খাতার আগে** (v9.44) — Today All Collection-এ **হিসাবের খাতার ঠিক আগে** Close ও Undo button। Undo শেষ Close batch-এর entries একই ID-তে History থেকে Today-তে ফেরায়; installment Actual, paid archive ও collections অপরিবর্তিত থাকে, Neon-এ ID-based sync হয়। Staff নিজের entries, Admin সব entries Undo করতে পারে; Manager read-only।
- **📌 প্রতিশ্রুতি = বাকী কিস্তির subset** (v9.43) — আজকের `nextDate` থাকলেও **পরিশোধিত বা আংশিক** কিস্তি আর আজ প্রতিশ্রুতি তালিকায় আসে না। একই `groups.due` source ব্যবহার হয়, তাই বাকী কিস্তিতে নেই এমন নাম প্রতিশ্রুতিতে দেখা যায় না; saved followup/note মুছে যায় না।
- **⚡ Active-only compact memberDB** (v9.42) — marked **② সদস্য তালিকা** upload সরানো হয়েছে। Balance-এ nonzero loan/savings/DPS অথবা current installment list-এ থাকা সদস্যদের পুরোনো directory থেকে শুধু **কেন্দ্র, Member No, নাম, মোবাইল, অভিভাবক** রাখা হয়; inactive/zero-only bulk row বাদ। Current fixture-এ **৫,০৮১ → ৯১৪** contacts। Balance/installment, Today, history, collections, paid archive ও sync data এই pruning-এ বদলায় না। Active source load না হলে সতর্কতার জন্য directory খালি করা হয় না।
- **💰 Installment details থেকে আদায় + Return** (v9.41) — **আজ প্রতিশ্রুতি, আজ আদায়যোগ্য, বাকী কিস্তি ও আংশিক কিস্তি** page-এর member details-এ কলের পাশে আদায় button। Click করা কিস্তির exact reference ও বাকী loan Today-তে prefill হয়; Return ঐ originating page-এ ফেরায়। Manager-এর button নেই, Staff শুধু নিজের member-এর আদায় পায়; duplicate ও installment update rules অপরিবর্তিত।
- **👥 অন্যান্য সদস্য তালিকা** (v9.40) — পূর্বের স্থিতির CSV থেকে loan/savings/DPS আছে এমন সদস্য, তবে installment-listed monthly সদস্য ও শূন্য স্থিতি বাদ। উপরের staff, center, search-type, search ও Clear filters ব্যবহার করে; default-এ সব center। Center name/code header, center subtotal ও filtered total অপরিবর্তিত। Member row-এর details-এ কলের পাশে আদায় button থেকে Today-তে prefill হয় এবং Return আগের page-এ ফেরায়।
- **👤 Today-এর active staff member-entry tables** (v9.40) — existing center-wise monthly/other tables অপরিবর্তিত। যে staff-এর ওই দিন আদায় আছে শুধু তার আলাদা member-entry table; empty staff table নেই। প্রতি table-এ monthly/other ধরন, member code/center/name, loan/savings/DPS/total এবং category subtotal; সবার শেষে **সকল স্টাফ সর্বমোট**। একই `entryOwnerStaff` visibility/fallback rule ও role-based data ব্যবহার হয়।
- **🧮 Today All Collection-এ সম্মিলিত সর্বমোট** — মাসিক ও অন্যান্য আদায়ের **লোন, সঞ্চয়, DPS আলাদাভাবে যোগ করে** এবং সবশেষে মোট দেখায়। Role-based visibility অনুযায়ী শুধু দেখা entries-এর হিসাব হয়; কোনো entry দ্বিগুণ গণনা হয় না। Entry input-এ লাল caret, উজ্জ্বল focus frame, focus event-এর JS class এবং focused label-এ ✏️ indicator আছে।
- **🛡️ Settings → Backup Download** — Neon/API বন্ধ থাকলেও এই ডিভাইসের সর্বশেষ cached document ও pending outbox patch-এর JSON backup নেওয়া যায়। Backup-এ settings, identity, API key বা `DATABASE_URL` থাকে না। Restore-এর আগে timestamp, row/member/Today ও pending count যাচাই করতে হবে।
- CSV কলাম স্বয়ংক্রিয়ভাবে চিনে নেওয়া
- **② পূর্বের স্থিতির CSV** — `Member ID`, `Member Name`, `Savings Balance`, `DPS Balance`, `Loan Balance` পড়ে। `Item Code: … Item Name: …` লোন-প্রোডাক্ট হেডার সারি বাদ দেয়, একই সদস্যের **একাধিক লোন প্রোডাক্টের সারি নিজে থেকেই যোগ** করে এক সারি করে; পুরোনো `Name of Member` / `Samity:` ফরম্যাটেও সেন্টার যুক্ত করে।
- **📥 MIS ফাইল একসাথে আপলোড** — শুধু **দুটি ফাইল** (① কিস্তির তালিকা · ② পূর্বের স্থিতি)। **CSV · লেগ্য .xls · HTML** সব ফরম্যাটই চলে; কোন ফাইলটি কী রিপোর্ট তা অ্যাপ নিজে থেকেই চেনে। পুরোনো Members Profile / Monthly Savings & Loan Collection Report upload আর গ্রহণ করে না।
- কিস্তি তালিকায় কর্মী বাছলে সেন্টার ড্রপডাউন শুধু ওই কর্মীর CSV-তে থাকা সেন্টার দেখায়; কর্মী বদলালে অসামঞ্জস্যপূর্ণ সেন্টার বাছাই নিজে থেকে মুছে যায়
- কিস্তির অবস্থা: `InstallmentActual = 0` → বাকী, পরিমাণের কম → আংশিক, সমান/বেশি → আদায়
- কিস্তি ও আদায় তালিকায় ড্রপডাউন থেকে মেম্বার কোড, সমিতি কোড বা মেম্বার নাম বেছে সার্চ; অতিরিক্ত ফিল্টার ঐচ্ছিকভাবে খোলা যায়
- Today All Collection-এ Neon-এ থাকা সদস্য ডাটাবেজ থেকে কোড/নাম সাজেশন ও অটো-ফিল
- Today All Collection-এর স্থিতি **কার্ড ২ লাইনে** দেখায় — ১ম লাইন **পূর্বের স্থিতি** (লোন/সঞ্চয়/DPS, CSV থেকে), ২য় লাইন **এন্ট্রি পরে স্থিতি**; লোন/সঞ্চয়/DPS বক্সে টাইপ করলেই ২য় লাইন লাইভ যোগ-বিয়োগ করে দেখায় (সেভ করার আগেই), সাথে নতুন এন্ট্রির মোট দেখায়
- যেকোনো সদস্য-সারিতে ক্লিক করলে CSV-র সব সদস্য-তথ্য ও ফোন করার অপশন দেখা যায়
- **কিস্তি ও আদায় তালিকার সারিতে ক্লিক করলে** active compact memberDB থেকে **Father / Husband / Care Of**, মোবাইল, কেন্দ্র, নাম ও Member No দেখায়; full বা শেষ ৪ সংখ্যার কোড দিয়ে মেলে, না মিললে শুধু current report-এর তথ্য দেখায়।
- MIS রিপোর্টের অপ্রয়োজনীয় কলাম — **SLNo, OfficeID, OfficeCode, OfficeName, ProductCode, ProductName, MainProductCode, MainItemName, EmployeeCode, SCBalance, Remarks, LoanSummaryID** — ডিটেইলস মোডালে (কিস্তি/আদায়/Today/ডাটাবেজ) কখনো দেখানো হয় না; প্রয়োজনীয় কলাম ও প্রতিশ্রুতির তথ্য অপরিবর্তিত থাকে
- ডিটেইলস মোডালে **গুরুত্বপূর্ণ তথ্য আগে** দেখায় — মেম্বার কোড, সদস্যের নাম, সেন্টার, **Father / Husband / Care Of**, মোবাইল, কিস্তির অঙ্ক, তারিখ; বাকি MIS/লোন-টেকনিক্যাল তথ্য (PRINCIPALLOAN, DURATION, MONTHPASSED, LBALANCE, INTCHARGE, NOOFFULLPAYMENT…) **"📋 অন্যান্য তথ্য (লোন / MIS)"** হেডিং-এর নিচে সরে যায়
- `Center Code & Name` একসাথে থাকলে (যেমন `0001, GOBRA BAZAR`) সেন্টার কোড শেষ ৩ সংখ্যায় ও সেন্টারের নাম আলাদা করে দেখায়
- **MIS লোন CSV** (EmpName, CenterCode, MemberCode, InstallmentStartDate…) নিজে থেকেই চেনে নেয় — ষ্টাফের নাম `EmpName` থেকে, তারিখ `InstallmentStartDate` থেকে (খালি `InstallmentDateActual` নয়), কিস্তি `InstallmentAmount` ও আদায় `InstallmentActual` থেকে
- Active memberDB-তে মেম্বার কোডে মিল না গেলে **একমাত্র নাম + কেন্দ্রের match** খোঁজে; না মিললে current balance/installment তথ্যই দেখায়।
- **💵 আদায় নিন** ফর্মে লোন, সঞ্চয়, ডিপিএস এবং তারিখ আলাদা করে যোগ হয়; মোট স্বয়ংক্রিয়ভাবে হিসাব হয়
- লোন আদায় কিস্তির `InstallmentActual`-এ যোগ হয়; আংশিক কিস্তি আংশিক থাকে, সম্পূর্ণ হলে আদায় টেবিলে যায়
- আলাদা **আদায় তালিকা** পেজে প্রতিটি লেনদেন, সদস্য/মোবাইল, তারিখ ও ক্যাটাগরি-ভিত্তিক মোট দেখা যায়; প্রতিটি রেকর্ড edit/delete করা যায়, edit-এ কিস্তির actual-ও সমন্বয় হয়
- **আদায় তালিকা** পেজে **↻ রিসেট** বাটন: এক চাপে পুরো আদায় তালিকা খালি হয় এবং কিস্তির আদায়ের অঙ্ক ফিরে আসে; রিসেট না দেওয়া পর্যন্ত তালিকা খালি হয় না, তাই রিফ্রেশ করলেও তথ্য থাকে
- **⌨️ স্মার্ট কীবোর্ড** (v9.5) — কিস্তি তালিকায় সার্চের ধরন **মেম্বার কোড** বা **সেন্টার কোড** বাছলে ফোনে **সংখ্যা-কীবোর্ড** (numeric) আসে; **মেম্বার নাম** বাছলে সাধারণ কীবোর্ড; **প্রতিশ্রুতির তারিখ** বাছলে তারিখ-পিকার। কোডের ঘরে বাংলা অঙ্ক (৩২৯৮) লিখলেও নিজে থেকেই ইংরেজি (3298) হয়ে যায়। Today পেজের সেন্টার কোড ও সদস্য-ডাটাবেজের কোড/সেন্টার সার্চেও একই সংখ্যা-কীবোর্ড।
- **🧹 পরিষ্কার সদস্য-বিস্তারিত** (v9.9 → v9.10) — কিস্তি তালিকা **ও Today All Collection** দুই জায়গার সদস্য-বিস্তারিত থেকে **STATUS, MEMBER TYPE, INTCHARGE, NOOFFULLPAYMENT, NOOFPARTIALPAYMENT, NOOFNOTPAYMENT** কার্ড বাদ (`HIDDEN_DETAIL_KEYS` + `stripHiddenDetails()`)। শিরোনামহীন কলামের অগোছালো **"তথ্য —"** কার্ডও আর আসে না। Today পেজে **আজকের লোন/সঞ্চয়/DPS/মোট ও সর্বশেষ স্থিতি** এখন একদম উপরে।
- **📱 মোবাইল থেকে ডিপ্লয়** (v9.8) — টোকেন ছাড়াই: রিপোতে নতুন **lean zip** (`COLLECTION-neon-vX.zip`, ~৭২ KB) আপলোড করলেই Netlify নিজে `dist/` বানিয়ে ফাংশনসহ ডিপ্লয় করে (রিপোর রুটের `netlify.toml`, টেমপ্লেট: `netlify-repo-root.toml`)। বিল্ড কমান্ড টেস্ট ফাইল ও CSV পাবলিশ থেকে বাদ দেয়। বিস্তারিত: **`MOBILE-DEPLOY.md`**।
- **☰ আট logical page-এর bottom-right menu** (v9.40) — App open-এ **Today All Collection** default। পুরোনো দুই tab-এর জায়গায় bottom-right fixed three-line menu থেকে Today, আজ প্রতিশ্রুতি, আজ আদায়যোগ্য, বাকী কিস্তি, আদায় কিস্তি, আংশিক কিস্তি, অন্যান্য সদস্য তালিকা ও স্থায়ী আদায় আর্কাইভ আলাদা page-এ খোলে। Active page-ই render হওয়ায় startup হালকা।
- **📌 আজ প্রতিশ্রুতি** হাইলাইট করা তালিকা বাকী কিস্তির উপরে থাকে — এতে শুধু **বাকী কিস্তির সেই সদস্যরা** আসে যাদের **প্রতিশ্রুতি / পরবর্তী তারিখ = আজকের তারিখ** (তারিখটা **ইউজার নিজে হাতে লিখেছেন** `📝 লিখুন` / `📝 সম্পাদনা` দিয়ে)। পরিশোধিত/আংশিক কিস্তির saved note থাকলেও এই তালিকায় দেখা যায় না।
- **📌 আজ প্রতিশ্রুতি** এখন menu থেকে খোলা আলাদা logical page; `Today All Collection` পেজে এই ব্লক নেই। ব্লকের শেষ কলাম **প্রতিশ্রুতি / পরবর্তী তারিখ**-এ শুধু **ইউজার নিজে হাতে যা লিখেছেন** সেটাই দেখায় (`📝 লিখুন` / `📝 সম্পাদনা` দিয়ে); অ্যাপ নিজে থেকে ওই ঘরে কোনো তারিখ বসায় না — খালি থাকলে `—` দেখায়। সারিটি কেন আজকের তালিকায়, তা বোঝা যায় এর **তারিখ (কিস্তির তারিখ)** কলাম থেকে, যা আজকের তারিখই দেখায়
- **💰 আজ আদায়যোগ্য** (v9.0) — **আজ প্রতিশ্রুতি ও বাকী কিস্তির মাঝখানে** থাকা টেবিল। এতে আসে আজ যে কিস্তি পড়েছে (কিস্তির তারিখ = আজ) অথচ টাকা এখনো পুরো আসেনি — **বাকী + আংশিক**। আজকের পাওনা এক নজরে দেখার জায়গা।
- **আদায় হয় শুধু Today All Collection পেজ থেকে** (v9.0) — কিস্তি তালিকার "💵 আদায় নিন" বাটন বাদ। Today পেজে সদস্য কোড লিখলেই নাম/সেন্টার/বাকী অঙ্ক নিজে থেকেই বসে যায়, আর `＋ তালিকায় যোগ` চাপলেই সেটি **কিস্তি তালিকার বাকী/আংশিক থেকে সরাসরি আদায় কিস্তিতে** চলে যায় (আংশিক টাকা হলে বাকী কমে আংশিকেই থাকে)।
- **Today All Collection পেজে দুই টেবিল** — **📅 মাসিক আদায়** (কিস্তি তালিকার সদস্য) ও **🗂️ অন্যান্য আদায়** (কিস্তি তালিকায় নেই এমন সদস্য — শুধু সঞ্চয়/DPS/অন্যান্য)।
- **↻ Today All Collection-এর রিসেট = শুধু এন্ট্রি ঘর ফাঁকা** (v9.3) — মেম্বার কোড/নাম/লোন/সঞ্চয়/DPS ঘরগুলো খালি হয় ও ফর্ম প্রস্তুত হয়; তালিকা, কিস্তির আদায় বা খাতা — কিছুই বদলায় না।
- **আদায় হয়ে গেলে তা স্থায়ী** (v9.3) — রিসেট든 ক্লোজ든 কিস্তির টাকা আর বাকীতে ফেরে না। প্রতিশ্রুতি / আজ আদায়যোগ্য / বাকী / আংশিক তালিকার সদস্য Today পেজ থেকে আদায় নিলেই **আদায় কিস্তিতে** চলে যায়; আংশিক হলে **আংশিক তালিকায়** থাকে, আর পরে বাকী টাকা পুরো দিলে (মোট আদায় = কিস্তি) **আদায় কিস্তিতে** চলে যায় ও ওঁর প্রতিশ্রুতি/পরবর্তী তারিখ স্বয়ংক্রিয়ভাবে মুছে যায়।
- **✔️ হিসাব ক্লোজ** (v9.3) — দিনের কাজ শেষে এই বাটন চাপলে আজকের সব এন্ট্রি **📚 হিসাবের খাতায়** তারিখভিত্তিক জমা হয় এবং **মাসিক ও অন্যান্য — দুই টেবিলই ফাঁকা হয়** (এটাই তালিকা খালি করার একমাত্র উপায়)। কিস্তির আদায় অপরিবর্তিত। খাতায় **📅 তারিখ ফিল্টার** দিয়ে নির্দিষ্ট দিনের **মাসিক** ও **অন্যান্য** আদায় আলাদা আলাদা (ও মোট) দেখা যায়; সারসংক্ষেপে এন্ট্রি সংখ্যা, মাসিক/অন্যান্য/মোট টাকা দেখায়। এই খাতা **কখনো মুছে যায় না** ও Neon-এ সেভ থাকে।
- **আলাদা "আদায় তালিকা" পেজ আর নেই** — Today পেজই আদায়ের একক জায়গা; নাম বদলের বদলে সেখানেই সব দেখা যায়।
- Bottom-right three-line menu থেকে আজ প্রতিশ্রুতি / আজ আদায়যোগ্য / বাকী কিস্তি / আদায় কিস্তি / আংশিক কিস্তি / অন্যান্য সদস্য তালিকা / স্থায়ী আদায় আর্কাইভ আলাদা page-এ দেখা যায়
- সার্চ-ড্রপডাউনে **প্রতিশ্রুতির তারিখ** বেছে নিলে সার্চ বক্স তারিখে বদলে যায়—ঐ তারিখে কার প্রতিশ্রুতি আছে তা দেখা যায়
- সব জায়গায় **মেম্বার কোডের শেষ ৪ সংখ্যা** ও **সেন্টার কোডের শেষ ৩ সংখ্যা** দেখায়; মূল কোড অপরিবর্তিত থেকে মিলানো ও সেভ করা হয়
- সব তালিকা ও ড্রপডাউন **A→Z (ছোট থেকে বড়)** সাজানো
- একমাত্র ডাটা স্টোর হলো **Neon PostgreSQL**; serverless function-এর মাধ্যমে সার্ভার-সাইডে সংযোগ
- নতুন ভার্সন প্রকাশের পরে পুরোনো `app.js`/`styles.css` ব্রাউজারের ক্যাশে আটকে থাকলে যেন নতুন ফিচার না দেখা যায় — তাই অ্যাসেটে `?v=` ক্যাশ-বাস্টিং, স্ট্যাটিক ফাইলে `no-store` হেডার, আর অ্যাপ চালু হলে ভার্সন বদলালে নিজে থেকে একবার রিফ্রেশ হয়

## Neon সেটআপ (একবার করতে হবে)

### ১. Neon ডাটাবেস টেবিল তৈরি

Neon Console → SQL Editor-এ `sql/schema.sql` ফাইলের SQL একবার চালান। অ্যাপ একটি JSON snapshot `collection_app_state` টেবিলে রাখে। এই অ্যাপের কিস্তি ও আদায়ের রেকর্ড Neon-এ থাকে; শুধু এই ব্রাউজারে বা GitHub repository-তে collection data রাখা হয় না।

### ২. Netlify environment variables দিন

রেপোটি Netlify-তে **Import from Git** করে deploy করুন, যাতে `netlify/functions/data.js`-ও deploy হয়। Netlify Site configuration → Environment variables-এ যোগ করুন:

- `DATABASE_URL` — Neon Console থেকে নেওয়া **pooled PostgreSQL connection string** (`-pooler` host হলে ভালো)। এটি Neon API key নয় এবং কখনোই browser code বা GitHub-এ দেবেন না।

এরপর Netlify-তে নতুন deploy চালান। `.env.example` শুধু নমুনা; বাস্তব secret `.env` বা Netlify settings-এ রাখুন।

### ৩. Public access (login নেই)

এই build-এ অ্যাপ অ্যাক্সেস কোড/login ইচ্ছাকৃতভাবে বাদ। `DATABASE_URL` server-side secret হিসেবেই থাকে, কিন্তু `/api/data` endpoint-এ user authentication নেই। Site link-এ পৌঁছতে পারা যে কেউ সদস্য/মোবাইল/অভিভাবক/ব্যালেন্স ও আদায়-ইতিহাস পড়তে এবং API দিয়ে ডাটা বদলাতে বা মুছতে পারে। ব্যক্তিগত বা সংবেদনশীল তথ্যের জন্য ব্যবহার করবেন না; নিয়ন্ত্রিত access দরকার হলে authenticated login যোগ করুন।

## 📥 MIS ফাইল একসাথে আপলোড (gBanker → অ্যাপ)

gBanker থেকে ডাউনলোড করা **দুটি ফাইল** এক জায়গায় বাছলেই current installment ও balance আপডেট হয় এবং active-only compact contact তৈরি হয়।

| রিপোর্ট | gBanker-এর স্ক্রিন | ফাইলের ধরন | অ্যাপে যা আপডেট হয় |
|---|---|---|---|
| ① কিস্তির তালিকা | `Groupwise Report → Monthly Installment Schedule` | এক্সপোর্ট (HTML, `.xls` নামে সেভ করলেও চলবে) | কিস্তির তালিকা + আজ প্রতিশ্রুতি |
| ② পূর্বের স্থিতি | `Balance Compare with Passbook (POMIS)` | `.csv` / `.xls` | লোন · সঞ্চয় · DPS স্থিতি + active-only compact contacts |

**যেভাবে ব্যবহার করবেন**
1. gBanker থেকে দুটি রিপোর্ট এক্সপোর্ট করে ডাউনলোড করুন (`.xls`, `.csv`, `.html` — কোনো মডিফাই লাগবে না)।
2. অ্যাপে **📥 MIS ফাইল আপলোড** খুলুন (উপরে-ডানে 📤 বাটন)।
3. **📂 দুটি ফাইল একসাথে বেছে নিন** — অথবা ① ② ঘরে একটি একটি করে।
4. অ্যাপ ফাইলগুলো পড়ে **নিজে থেকেই চেনে নেয় কোনটি কী রিপোর্ট** (হেডার দেখে) — ভুল ঘরে বসলেও সঠিক ঘরেই বসে।
5. **⬆️ ফাইলগুলো আপলোড করে ডেটাবেজ আপডেট করুন** চাপুন — সব ডেটা Neon-এ সেভ হয়, তাই সব ডিভাইসে পাওয়া যায়।

**যা যা পারে**
- তিনটি ফরম্যাটই পড়া হয়: **CSV · লেগ্য .xls (OLE2/BIFF8) · HTML টেবিল** — ফাইলের নাম বা এক্সটেনশন দেখে নয়, **ভেতরের ফরম্যাট দেখে**।
- লেগ্য `.xls` পড়ার জন্য প্রজেক্টে নিজস্ব পাঠক আছে (`shared/xls-reader.js`) — কোনো বাড়তি npm প্যাকেজ নেই, ব্রাউজারেও চলে।
- ② পূর্বের স্থিতির "Balance Compare with Passbook (POMIS)" রিপোর্টের `General Savings` → **সঞ্চয়**, `Monthly/LTS Savings` → **DPS**, `Loan Balance` → **লোন**; একই সদস্যের একাধিক লোন প্রোডাক্ট থাকলে নিজে থেকেই যোগ হয়, আর সামিতি/সেন্টার কোডও ধরা পড়ে।
- প্রতিটি upload/load-এ `shared/active-members.js` nonzero balance + current installment থেকে contact prune করে; source data unavailable হলে কোনো deletion করে না।
- একটি ফাইল ব্যর্থ হলে বাকি ফাইলগুলো আপলোড হয়।

## ডিপ্লয়/হোস্টিং

- **Neon মোড:** Netlify Functions-সমর্থিত Netlify deploy ব্যবহার করুন। `netlify.toml` `/api/data` endpoint-টি Function-এ পাঠায়। শুধু static drag-and-drop deploy করলে Function থাকবে না।
- **GitHub Pages:** static hosting—Neon Function চালাতে পারে না। Neon-only অ্যাপ চালাতে serverless function সমর্থিত hosting ব্যবহার করুন।
- `npm install` দিয়ে server dependency ইনস্টল হয়. Netlify build-এ function bundle-ও স্বয়ংক্রিয়ভাবে তৈরি হবে।

## ডেটা ও গোপনীয়তা

- Neon connection string server environment-এ রাখুন; কোনো secret source control-এ commit করবেন না। Public data API-তে login নেই; link জানা যে কেউ ডাটা পড়তে ও পরিবর্তন করতে পারে।
- `DATABASE_URL` হলো PostgreSQL connection string; Neon management API key-এর বিকল্প নয়।
- Neon-এ CSV ডাটা এবং আদায়-ইতিহাস একই snapshot-এ রাখা হয়। একাধিক ব্যক্তি একই সময়ে আপডেট করলে সর্বশেষ save-টি থাকবে। পুরোনো ক্লায়েন্ট যদি আদায়-ইতিহাসের ফিল্ড না পাঠায়, সার্ভার বিদ্যমান ইতিহাস রেখে দেয়।
- `.env`, `.env.*` `.gitignore`-এ বাদ; শুধু `.env.example` commit করা নিরাপদ।

## লোকাল ডেভেলপমেন্ট

`netlify/functions/data.js` হলো API endpoint; local Netlify runtime-এ পরীক্ষা করতে `DATABASE_URL` environment variable দিতে হবে। অ্যাপের collection data কেবল Neon-এ পড়া/লেখা হয়; browser storage-এ শুধু UI preference থাকে।

## Neon ডাটা স্থায়িত্ব

কিস্তি ও আদায়ের ডাটা Neon PostgreSQL-এ থাকে—browser বন্ধ করা বা cache মুছলে ডাটাবেসের রেকর্ড মুছে যায় না। এই build-এ অ্যাপ অ্যাক্সেস কোড নেই; browser session-এ কোড রাখার দরকার পড়ে না। Neon account-এর plan ও backup আলাদাভাবে পরিচালনা করুন।

## Today All Collection ও active member details

- **Today All Collection** পেজে মেম্বার কোড, সেন্টার কোড, নাম, লোন, সঞ্চয় ও DPS দিয়ে দৈনিক তালিকা তৈরি করা যায়। Entry Neon-এ shared save হয়; offline হলে persistent outbox-এ থেকে reconnect-এ sync হয়। Reset শুধু entry form ফাঁকা করে, saved list বা কিস্তি বদলায় না।
- সব স্ক্রিনে মেম্বার কোডের প্রথম ৩টি সংখ্যা দেখানো হয় না; মূল CSV/ডাটাবেসের কোড অপরিবর্তিত থাকে, যাতে matching ও সার্চ ঠিক থাকে.
- **📥 MIS ফাইল আপলোড** মডালে কিস্তির তালিকা ও পূর্বের স্থিতি বাছলে current report, balance এবং active compact contacts আপডেট হয়। সদস্য কোড দিলে নাম/সেন্টার auto-fill হয়; Member ID-এর শেষাংশ, কেন্দ্র ও নাম দিয়ে আগের লোন/সঞ্চয়/DPS মেলে। সারি ক্লিক করলে অভিভাবকের তথ্য ও কল বাটন দেখা যায়। নতুন একই-ধরনের report আগের report বদলে দেয়, কিন্তু আদায়-ইতিহাস মুছে না।
- মূল কিস্তি CSV নতুনটি দিয়ে আগের কিস্তি CSV-র headers/rows প্রতিস্থাপন করে; আলাদা Neon আদায়-ইতিহাস অক্ষত থাকে।

## আদায় রেকর্ডের ডেটা

প্রতিটি রেকর্ডে আদায়ের তারিখ, সদস্য কোড/নাম/মোবাইল, লোন, সঞ্চয়, ডিপিএস, মোট এবং আদায়ের সময়কার সদস্য-তথ্যের snapshot সংরক্ষিত হয়। লোনের অংশটুকুই `InstallmentActual`-এ যোগ হয়; সঞ্চয় ও ডিপিএস কিস্তির বকেয়াকে পরিবর্তন করে না।
