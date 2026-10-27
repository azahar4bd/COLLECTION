# 📱 মোবাইল থেকে Netlify-তে ডিপ্লয় — ধাপে ধাপে

## ✅ এখনকার অবস্থা (২১ অক্টোবর ২০২৬) — সেটআপ শেষ, ডিপ্লয় লাইভ

রিপো **azahar4bd/COLLECTION** → Netlify (`collection-bkf`) লিংক করা আছে, আর রিপোর রুটে **`netlify.toml`** বসানো আছে।
বর্তমান প্রোডাকশন: **v9.8** (যাচাই: `app.js` → `APP_VER 'v9.8'`, `/api/data` → HTTP 200, ৪৮৪ কিস্তি + ৫,০৮১ সদস্য অটুট)। পরবর্তী বিল্ড: **v9.9** (সদস্য-বিস্তারিতের অপ্রয়োজনীয় কার্ড বাদ)। ফাইলের নাম সবসময় `COLLECTION-neon-vX.zip`।

### প্রতিবার আপডেট করতে শুধু এই ৩ ধাপ
1. নতুন **lean** `COLLECTION-neon-vX.zip` ফোনে ডাউনলোড করুন (v9.8 থেকে সব ছোট zip — ৭২ KB-এর মতো)
2. GitHub রিপো → **Add file → Upload files** → zip-টা বেছে নিন → **Commit changes**
   (রেডিওতে **Commit directly to the `main` branch** সিলেক্ট থাকতে হবে — নাহলে merge করতে হবে)
3. Netlify → **Deploys** অথবা GitHub → **Actions**-এ অপেক্ষা করুন → **Published** / সবুজ ✔

> ফাইলের নাম **COLLECTION-neon-v…zip** প্যাটার্নে রাখুন; বিল্ড কমান্ড নামের ভার্সন ধরে সবচেয়ে নতুনটাই বাছে।
> `index.html` / `app.js` / `styles.css` আলাদা করে আপলোড করার দরকার নেই — zip-ই যথেষ্ট।

---

## 🔒 ফাইল পরিষ্কার রাখা (v9.8) — কেন জরুরি

v9.7-এর zip-এ `MemberlistReport.csv` (১০৭ KB) ও `MonthlyBalances.csv` (১৫৭ KB) ছিল।
এতে **আসল সদস্যের নাম, মোবাইল নম্বর, অভিভাবকের নাম, সঞ্চয় ও ঋণ ব্যালেন্স** আছে।
অ্যাপে লগইন নেই, তাই সাইটে ওই ফাইল দুটো যে কেউ নামিয়ে নিতে পারত।

### যা করা হয়েছে
- **lean zip** — `COLLECTION-neon-v9.8.zip` (৭২ KB, ১২টি ফাইল)। এতে টেস্ট কোড (`test-*.cjs`), `test-fixtures/`, `sql/`, `sandbox-server.mjs` বা কোনো `.csv` নেই। **এখন থেকে এই zip-টাই আপলোড করবেন।**
- **বিল্ড কমান্ডে prune** — `rm -rf dist/test-*.cjs dist/test-fixtures dist/sql dist/sandbox-server.mjs dist/.github dist/README.md dist/MOBILE-DEPLOY.md dist/netlify-repo-root.toml dist/*.csv dist/preview-data.json`
  তাই ভবিষ্যতে ভুলে বড় (full) zip আপলোড হলেও ওয়েবসাইটে টেস্ট ফাইল বা CSV পাবলিশ হবে না।

### একবারের পরিষ্কার কাজ
1. **`COLLECTION-neon-v9.8.zip` আপলোড করুন** (Add file → Upload files → Commit changes)
2. **পুরোনো `COLLECTION-neon-v9.7.zip` ডিলিট করুন** — রিপোতে ওটা প্রকাশ্য, আর ভেতরে আসল সদস্য-ডেটা আছে
   ফাইল খুলুন → উপরে 🗑️ (Delete file) → **Commit changes**
   (ডিলিট করার পরেও বিল্ড চলবে, কারণ সবচেয়ে নতুন zip = v9.8)
3. **রিপো-রুটের পুরোনো v4.3 কোড সরান** (ঐচ্ছিক, publish হয় না): `index.html`, `app.js`, `styles.css` — প্রতিটি খুলে 🗑️ **Delete file** → Commit
4. **রিপো-রুটের `netlify.toml` আপডেট করুন** (prune লাইন যোগ করতে): ফাইল → ✏️ → পুরোটা মুছে নিচের লেখা পেস্ট → Commit

> পুরোনো `COLLECTION-neon-v9.6.zip` / `v9.5.zip` ইত্যাদিও রিপোতে থাকলে একইভাবে ডিলিট করুন (ওগুলোতেও CSV ছিল)।
> লোকাল ব্যাকআপ চাইলে `COLLECTION-neon-v9.8-LOCAL-full.zip` ওয়ার্কস্পেসে আছে — **ওটা কখনো GitHub-এ আপলোড করবেন না।**

### যাচাই করার ২টি লিংক
- **https://collection-bkf.netlify.app** → মাথার ব্যাজে `Neon · v9.7`
- **https://collection-bkf.netlify.app/api/data** → JSON (কাঁচা ডেটা)

### ⚠️ যেসব ভুল হয়েছে (আর করবেন না)
- রিপোতে সরাসরি `index.html`/`app.js` রাখা আছে (পুরোনো v4.3) — ওগুলো পাবলিশ হয় না, কারণ publish = `dist`। মুছলেও ক্ষতি নেই, রাখলেও না।
- ফাইলের নাম ভুল হলে (`netlify.tom1`) Netlify কিছুই পড়ে না — নাম হুবহু **netlify.toml** হতে হবে।
- সাইটের কোড আপডেট ≠ ডেটা আপডেট — Neon-এর ডেটা ডিপ্লয়ে অটুট থাকে।

---

> এই অ্যাপে **একটি Netlify Function** আছে (`netlify/functions/data.js`) যেটা Neon ডেটাবেজের সাথে কথা বলে।
> তাই শুধু ফাইল "ড্র্যাগ-ড্রপ" করে ডিপ্লয় করলে **চলবে না** — ফাংশন ছাড়া `/api/data` কাজ করবে না, অ্যাপে ডেটা দেখাবে না।

## কোন পথ বেছে নেবেন

| পথ | ফোন থেকে সম্ভব? | ফাংশন কাজ করে? | টোকেন লাগে? | কষ্ট |
|---|---|---|---|---|
| **⓪ শুধু zip আপলোড → Netlify নিজেই বিল্ড** ⭐⭐ সবচেয়ে সহজ | ✅ হ্যাঁ | ✅ হ্যাঁ | ❌ লাগে না | একবার লিংক, পরে শুধু ১টা zip আপলোড |
| **① GitHub-এ ফাইল আপলোড → Actions অটো-ডিপ্লয়** | ✅ হ্যাঁ | ✅ হ্যাঁ | ✅ ২টি secret | একবার সেটআপ, পরে ফাইল আপলোড |
| ② Netlify-তে Git রিপো কানেক্ট করে অটো-বিল্ড | ✅ হ্যাঁ | ✅ হ্যাঁ | একবার লিংক করতে হয় |
| ③ Termux-এ Netlify CLI | ✅ হ্যাঁ | ✅ হ্যাঁ | প্রতিবার টার্মিনালে কমান্ড |
| ④ Netlify Drop (ফোল্ডার ড্র্যাগ-ড্রপ) | ❌ মোবাইল ব্রাউজারে ড্র্যাগ-ড্রপ চলে না | ❌ ফাংশন সাপোর্ট করে না | **ব্যবহার করবেন না** |

---

## ⭐⭐ পথ ⓪: রিপোতে শুধু zip আপলোড → Netlify নিজেই বিল্ড করে (কোনো টোকেন নেই)

এই পথে **কোনো টোকেন কোথাও লিখতে হয় না**। শুধু একবার Netlify-র সাথে রিপো লিংক করতে হয় (GitHub লগইন দিয়ে, কপি-পেস্ট কিছু নেই)। এরপর প্রতিবার মাত্র **একটা ফাইল** (zip) আপলোড করলেই ফাংশনসহ ডিপ্লয় হয়ে যায় — মোবাইলে সবচেয়ে সহজ।

### একবারের সেটআপ — এই ক্রমটাই রাখুন

**ধাপ ১ — রিপোতে নতুন zip-টা আগে আপলোড করুন**
1. রিপো: **https://github.com/azahar4bd/COLLECTION**
2. **Add file → Upload files** → `COLLECTION-neon-v9.7.zip` বেছে নিন → **Commit changes**
   (ফোনে zip এক ফাইল হিসেবেই আপলোড হবে — extract করার দরকার নেই)

**ধাপ ২ — রিপোর রুটে `netlify.toml` বানান**
1. **Add file → Create new file**
2. ফাইলের নাম: `netlify.toml` (একদম রুটে, কোনো ফোল্ডারে নয়)
3. এই প্রজেক্টের `netlify-repo-root.toml` ফাইলের **পুরো লেখাটা** কপি করে পেস্ট করুন
4. **Commit changes**

**ধাপ ৩ — Netlify-তে রিপো লিংক করুন**
1. **https://app.netlify.com** → `collection-bkf` সাইট → **Site configuration** → **Build & deploy** → **Continuous deployment**
2. **Link repository** → **GitHub** → অনুমতি দিন → রিপো **azahar4bd/COLLECTION** → ব্র্যাঞ্চ **main**
3. Build command / Publish directory ঘরে কিছু লিখবেন না — `netlify.toml` থেকে নিজেই নেবে
4. **Deploy** চাপুন → প্রথম বিল্ড চলবে (~১–২ মিনিট)

### এরপর প্রতিবার (মাত্র ৩ ট্যাপ)
1. নতুন `COLLECTION-neon-vX.zip` ডাউনলোড করুন
2. রিপো → **Add file → Upload files** → zip-টা বেছে নিন → **Commit changes**
3. Netlify → **Deploys** → নতুন বিল্ড → সবুজ **Published** = ডিপ্লয় শেষ

### ভেতরে কী হচ্ছে
`netlify.toml`-এর build command নিজেই রিপোতে থাকা সবচেয়ে নতুন `COLLECTION-neon-*.zip` খুঁজে (নামের ভার্সন ধরে, `sort -V`) সেটা `dist/`-এ unzip করে, `npm install --omit=dev` চালায়। publish = `dist`, functions = `dist/netlify/functions` — তাই ফাংশনও ঠিকভাবে ডিপ্লয় হয়।

> ⚠️ ধাপ ১ আগে করুন, ধাপ ৩ পরে — zip ছাড়া লিংক করলে প্রথম বিল্ড "cannot find zip" দিয়ে ফেল করবে।
> পুরোনো zip রিপোতে থেকে গেলে সমস্যা নেই (নতুনটাই বাছে); জায়গা বাঁচাতে চাইলে মাঝে মাঝে পুরোনোটা ডিলিট করুন।
> রিপোতে থাকা পুরোনো `index.html` / `app.js` (v4.3) পাবলিশ ফোল্ডারের বাইরে — তাই অ্যাপে কোনো প্রভাব ফেলে না।

---

## ⭐ পথ ①: GitHub → Actions → Netlify (একবার সেট করলেই শেষ)

### ধাপ ১ — Netlify থেকে একটি টোকেন নিন (একবারই)
1. ফোনের ব্রাউজারে যান: **https://app.netlify.com**
2. ডান-উপরে অ্যাকাউন্ট → **User settings** → **Applications** → **Personal access tokens**
3. **New access token** → নাম দিন (যেমন `mobile-deploy`) → **Generate token**
4. টোকেনটি কপি করে নিরাপদে রাখুন (একবারই দেখায়; চ্যাটে কাউকে দেবেন না)

### ধাপ ২ — GitHub-এ দুটি Secret বসান (একবারই)
রিপো: **https://github.com/azahar4bd/COLLECTION**

1. **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
2. প্রথমটি:
   - Name: `NETLIFY_AUTH_TOKEN`
   - Secret: (ধাপ ১-এর টোকেন)
3. **New repository secret** আবার চেপে দ্বিতীয়টি:
   - Name: `NETLIFY_SITE_ID`
   - Secret: `78a8c55b-7d31-46d2-a079-a4849e04633c`

> `DATABASE_URL` আলাদা করে দিতে হবে না — সেটা আগেই Netlify সাইটের Environment variables-এ আছে এবং ডিপ্লয়ে মুছে যায় না। (না থাকলে: Netlify → Site configuration → Environment variables → `DATABASE_URL`)

### ধাপ ৩ — ফাইলগুলো GitHub-এ আপলোড করুন (প্রতিবার এই কাজটুকু)
1. ফোনে এই বিল্ডের **zip** ডাউনলোড করুন এবং ফাইল ম্যানেজার দিয়ে **Extract** করুন
2. ব্রাউজারে রিপো খুলুন → **Add file** → **Upload files**
3. যেসব ফাইল বদলেছে সেগুলো বেছে নিন (নতুন ভার্সনে সাধারণত):
   - `index.html`
   - `app.js`
   - `styles.css`
   - `netlify/functions/data.js`
   - `.github/workflows/netlify-deploy.yml` (নতুন)
4. নিচে **Commit changes** চাপুন

### ধাপ ৪ — ডিপ্লয় নিজে থেকেই হবে
- কমিটের পর GitHub → **Actions** ট্যাবে **"Deploy to Netlify (ফোন থেকেও চলবে)"** রান শুরু হবে (১–২ মিনিট)
- সবুজ ✔ দেখলে সাইটে যান: **https://collection-bkf.netlify.app**
- মাথার ব্যাজে নতুন ভার্সন (যেমন `Neon · v9.6`) দেখলেই বুঝবেন ডিপ্লয় হয়েছে
- যাচাই: **https://collection-bkf.netlify.app/api/data** খুললে JSON আসবে (ফাংশন ঠিক আছে)

---

## পথ ②: Netlify-তে রিপো লিংক = পথ ⓪-ই (বিস্তারিত উপরে)

একবার লিংক করলে GitHub-এ কমিট = সরাসরি ডিপ্লয় (Actions-ও লাগবে না)।
শুধু **Build command / Publish directory ফাঁকা রাখুন** — রিপোর রুটে রাখা `netlify.toml` নিজেই `dist/` বানিয়ে ফাংশনসহ পাবলিশ করবে।

> ⚠️ Publish directory-তে `.` লিখবেন না — তাহলে রিপোতে থাকা পুরোনো `index.html` (v4.3) পাবলিশ হয়ে যাবে, নতুন অ্যাপ দেখাবে না।

---

## পথ ③: Termux দিয়ে সরাসরি CLI (অ্যান্ড্রয়েড)

```bash
pkg update && pkg install nodejs unzip -y
mkdir -p ~/app && cd ~/app

# রিপোতে আপলোড করা নতুন zip নামিয়ে নিন (নাম নিজের ভার্সন অনুযায়ী বদলান)
curl -L -o app.zip https://github.com/azahar4bd/COLLECTION/raw/main/COLLECTION-neon-v9.7.zip
unzip -o app.zip -d .
npm install --omit=dev
npm i -g netlify-cli

netlify login
netlify link --site 78a8c55b-7d31-46d2-a079-a4849e04633c
netlify deploy --prod --dir=. --functions=netlify/functions
```

> `netlify login` ব্রাউজার খুলবে — ফোনে লগইন করে অনুমতি দিলেই হবে।

---

## কেন Netlify Drop ব্যবহার করবেন না

Netlify নিজেই বলছে — **Drag & Drop ডিপ্লয়ে ফাংশন চলে না**, আর **মোবাইল ব্রাউজার ড্র্যাগ-ড্রপ সাপোর্ট করে না**। তাই Drop দিয়ে দিলে সাইট খুলবে কিন্তু **ডেটা লোড হবে না** (`/api/data` → 404)।

---

## সমস্যা হলে

| লক্ষণ | কারণ ও সমাধান |
|---|---|
| বিল্ড ফেল: `cannot find COLLECTION-neon-*.zip` | ধাপ ১-এর zip আপলোড হয়নি — zip আপলোড করে **Deploys → Trigger deploy → Deploy site** চাপুন |
| সাইটে পুরোনো v4.3 দেখা যাচ্ছে | Publish directory-তে `.` লেখা আছে বা `netlify.toml` রিপোর রুটে নেই — মোছা/ঠিক করে আবার deploy |
| Actions লাল ❌, লেখায় "secret দেওয়া হয়নি" | ধাপ ২-এর দুটি secret ঠিক নামে বসাননি |
| Actions-এ "Netlify authentication failed" | টোকেন ভুল/মেয়াদ শেষ — নতুন টোকেন নিয়ে secret আবার বসান |
| সাইট খোলে কিন্তু ডেটা নেই | ফাংশন ডিপ্লয় হয়নি বা `DATABASE_URL` নেই — `netlify/functions/data.js` আপলোড হয়েছে কিনা ও Netlify env var দেখুন; `/api/data` খুলে পরীক্ষা করুন |
| পুরোনো ভার্সন দেখাচ্ছে | ফোনের Chrome-এ পেজ রিফ্রেশ করুন (নতুন ভার্সনে `?v=9.7` ক্যাশ-বাস্টিং আছে); এখনো না হলে Netlify → Deploys-এ সর্বশেষ বিল্ড **Published** কিনা দেখুন |
| ফাংশনে ডেটাবেজ এরর | Netlify → Functions → `data` → লগ দেখুন; `DATABASE_URL` ঠিক আছে কিনা যাচাই করুন |

---

## মনে রাখবেন

- **Neon-এর ডেটা ডিপ্লয়ের সাথে মুছে যায় না** — কোড আপডেট হলেও আপনার ৪৮৪ কিস্তি, ৫,০৮১ সদস্য, খাতা — সব অটুট থাকে।
- Netlify-র নিজের **মোবাইল অ্যাপ নেই**; তবে `app.netlify.com` মোবাইল ব্রাউজারে ভালোই চলে (Deploys দেখা, Rollback, Env var বদলানো সবই করা যায়)।
- টোকেন/পাসওয়ার্ড কোথাও পাবলিক রিপো বা চ্যাটে লিখবেন না।
