# 🔁 নতুন Netlify অ্যাকাউন্টে সাইট নেওয়া — `collection-bkf.netlify.app` ঠিকানা রেখে

_উদ্দেশ্য: পুরোনো অ্যাকাউন্টের ক্রেডিট-পজ এড়িয়ে নতুন ফ্রি অ্যাকাউন্টে (নতুন ৩০০ ক্রেডিট) একই URL-এ সাইট চালানো।_

---

## কেন সোজা "Transfer" বাটন নেই
Netlify-র নিয়ম: **Project configuration → General → Project information → Transfer project** — এই বাটন কাজ করে কেবল যখন আপনি **দুই টিমেরই Owner/Developer**। ফ্রি প্ল্যানে টিম **এক-সদস্যের**, তাই নতুন অ্যাকাউন্টকে পুরোনো টিমে যোগ করা যায় না → **সেলফ-সার্ভিস ট্রান্সফার বন্ধ**।
নিয়মটা Netlify-র নিজের ডকুমেন্টে: _"To transfer projects between teams with no shared Owners or Developers, please contact support."_

তাই দুইটা পথ — দুটোই `collection-bkf.netlify.app` ঠিকানা ধরে রাখে:

| | পথ | সময় | কে করবে |
|---|---|---|---|
| **A** | পুরোনো সাইটের **নাম বদল** → নতুন অ্যাকাউন্টে **একই নামে** নতুন সাইট → রিপো লিংক → ডিপ্লয় | ~৫ মিনিট, নিজেই | আপনি |
| **B** | Netlify সাপোর্টকে **Site Transfer** রিকোয়েস্ট | ১–২ দিন | আপনি + সাপোর্ট |

> দুটোতেই **Neon ডেটা অটুট** — ডেটা সাইটের সাথে বাঁধা নয়, `DATABASE_URL`-এ বাঁধা।

---

## পথ A — নাম ছেড়ে দিয়ে নতুন অ্যাকাউন্টে নেওয়া (সুপারিশ)

### ১. পুরোনো অ্যাকাউন্ট: সাইটের নাম বদলান
1. `app.netlify.com` → `collection-bkf` → **Project configuration → General → Project information**
2. **Change site name** → দিন: `collection-bkf-old` → Save
3. এখন `collection-bkf` নামটা **ছেড়ে দেওয়া হলো** (`collection-bkf-old.netlify.app` হবে পুরোনো সাইটের ঠিকানা)

### ২. পুরোনো সাইট থেকে `DATABASE_URL` কপি করুন
1. পুরোনো সাইট → **Project configuration → Environment variables**
2. `DATABASE_URL` → **Edit / reveal** → পুরোটা কপি করুন (কোথাও পাবলিকভাবে লিখবেন না, চ্যাটেও না)
3. না পেলে: Neon ড্যাশবোর্ড → Project → **Connect** → Connection string (pooled) কপি

### ৩. নতুন অ্যাকাউন্ট: সাইট বানান
1. নতুন অ্যাকাউন্টে ঢুকে **Add new project → Import an existing project → GitHub**
2. রিপো: **azahar4bd/COLLECTION**, ব্রাঞ্চ **main**
3. Build command / Publish directory **ফাঁকা** রাখুন (`netlify.toml` নিজেই সামলাবে)
4. **Deploy** → সাইটের নাম হবে `collection-bkf` (নাম না মিললে Settings → Change site name দিয়ে ঠিক করুন)
5. **Project configuration → Environment variables → Add a variable**:
   - Key: `DATABASE_URL`
   - Value: ধাপ ২-এ কপি করা স্ট্রিং
   - Scope: **All deploy contexts** → Save

### ৪. রি-ডিপ্লয় + যাচাই
1. **Deploys → Trigger deploy → Clear cache and deploy site**
2. খুলুন **https://collection-bkf.netlify.app**
   - মাথার ব্যাজে **v9.10** (v9.9/v9.10-এর কার্ড-বাদ সহ)
   - কিস্তি তালিকায় **৪৮৪ সারি**
   - **https://collection-bkf.netlify.app/api/data** → JSON (ফাংশন ঠিক)
3. সব ঠিক হলে পুরোনো সাইট (`collection-bkf-old`) **Delete project** করে দিন

> নামটা "already taken" বললে: কয়েক মিনিট অপেক্ষা করে আবার চেষ্টা করুন। তখনো না হলে পথ B-তে যান।

---

## পথ B — Netlify সাপোর্ট দিয়ে ট্রান্সফার (কিছু না ভাঙিয়ে)

1. খুলুন: **https://www.netlify.com/support/** → "What kind of help do you need?" → **Site/DNS Transfer**
2. এই তথ্যগুলো দিন (কপি-পেস্ট):
```
Requesting a project transfer between two Free accounts.

Site name: collection-bkf
Site URL: https://collection-bkf.netlify.app
Site ID: 78a8c55b-7d31-46d2-a079-a4849e04633c
Custom domain / DNS zone: none (using the netlify.app subdomain only)
Current account email: <পুরোনো অ্যাকাউন্টের ইমেইল>
Destination account email: <নতুন অ্যাকাউন্টের ইমেইল>
Reason: the current team's production deploys are paused by the known
"stuck operational credits" flag; a fresh Free account is needed.
Please keep the same site name/URL and the existing environment variables
(DATABASE_URL). No custom domain is involved.
```
3. সাপোর্ট সাধারণত ১–২ কর্মদিবসে করে দেয়; ডাউনটাইম হয় না, env var সহ সব সেটিংস যায়।
4. ট্রান্সফারের পর ব্যাজে **v9.10** দেখে নিন; না দেখলে **Trigger deploy**।

---

## যা মনে রাখতে হবে
- **নতুন অ্যাকাউন্টেও ৩০০ ক্রেডিট** = মাসে **২০টি production deploy** (প্রতিটি ১৫)। আপনার হার (দিনে ৫–৮ ডিপ্লয়) হলে **প্রতি মাসেই শেষ হবে** — তাই **zip আপলোড কমান**, একসাথে কয়েকটা ফিক্স করে একবার ডিপ্লয় করুন।
- **টেস্ট বিল্ড**: `Deploy Previews`/branch deploy **০ ক্রেডিট** — বড় পরিবর্তন আগে branch-এ দেখে নিলে ক্রেডিট বাঁচে।
- `DATABASE_URL` কোথাও পাবলিক রিপো/চ্যাটে লিখবেন না। নতুন সাইটে বসানোর পর পুরোনোটার দরকার নেই।
- পুরোনো সাইট ডিলিট করার আগে **নতুন সাইটে সব ঠিক আছে** দেখে নিন।
