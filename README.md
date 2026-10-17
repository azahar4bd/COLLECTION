# 💰 কালেকশন ম্যানেজার (Collection Manager)

🔗 **লাইভ সাইট: [https://collection-bkf.netlify.app](https://collection-bkf.netlify.app)**

CSV ফাইল দিলেই বাকী · আদায় · আংশিক কিস্তির ৩টা টেবিল — কোনো সিলেকশন/ম্যাপিং ছাড়াই (অটো-ডিটেক্ট)।

## ✨ ফিচার

- **CSV অটো-ডিটেক্ট**: CSV ফাইল দিলেই কলাম নিজে থেকেই চিনে নেবে (InstallmentActual, InstallmentAmount, ষ্টাফ, সেন্টার, মেম্বার, তারিখ) — কোনো ড্রপডাউন/সিলেকশন নেই
- **৩টা টেবিল** (স্বয়ংক্রিয় ক্লাসিফিকেশন):

  | টেবিল | নিয়ম |
  |-------|-------|
  | 🕒 বাকী কিস্তি | `InstallmentActual = 0` |
  | ✅ আদায় কিস্তি | `InstallmentActual ≥ InstallmentAmount` |
  | ⚠️ আংশিক কিস্তি | `InstallmentActual < InstallmentAmount` (কিন্তু ০ নয়) |

- **ফিল্টার**: ষ্টাফ (নাম) · সেন্টার কোড · মেম্বার কোড/নাম · তারিখ — সব টেবিলে একসাথে কাজ করে
- **কলাম (৯টি)**: মেম্বার কোড, মেম্বার নাম, সেন্টার কোড, সেন্টার নাম, ষ্টাফ নাম, তারিখ, কিস্তি (৳), আদায় (৳), বাকী (৳)
- **মোট হিসাব**: প্রতিটি টেবিলের নিচে মোট সংখ্যা · মোট কিস্তি · মোট আদায় · মোট বাকী
- **২ মোড**:
  - 📱 **লোকাল মোড** (ডিফল্ট): কোনো টোকেন লাগে না — ডাটা ব্রাউজারে সেভ হয়
  - ☁️ **GitHub মোড** (ঐচ্ছিক): ডাটা GitHub রেপোতে সেভ + অটো-সিঙ্ক

## 🚀 ব্যবহার

1. [লাইভ সাইট](https://collection-bkf.netlify.app) খুলুন
2. 📤 বাটন → CSV ফাইল দিন
3. **"📊 টেবিল দেখুন"** — ব্যস!

## 💾 ডাটা কোথায় থাকে?

- **লোকাল মোড**: আপনার ব্রাউজারে (localStorage) — কোনো সার্ভার/টোকেন লাগে না
- **GitHub মোড** (ঐচ্ছিক): সেটিংস (⚙️) → GitHub token + repo → `data/installments.json` ফাইলে সেভ হয়

## ⚙️ GitHub মোড সেটআপ (ঐচ্ছিক)

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained token** (Contents: Read & Write)
2. অ্যাপের ⚙️ সেটিংস → Token, Owner, Repo দিয়ে **সংযোগ সেভ করুন**

## 🌐 ডিপ্লয়

- **লাইভ**: [collection-bkf.netlify.app](https://collection-bkf.netlify.app) — Netlify
- **রিডিপ্লয় (Drag & Drop)**: Netlify → Add new site → Drag and drop (`index.html`, `styles.css`, `app.js`)
- **অটো-ডিপ্লয়**: Netlify → Add new site → Import from Git → GitHub → এই রেপো সিলেক্ট (প্রতিবার পুশে নিজে নিজেই ডিপ্লয় হবে)

## 🛠 টেক

ভ্যানিলা HTML/CSS/JS — কোনো বিল্ড নেই, কোনো সার্ভার ডাটাবেস নেই। ঐচ্ছিকভাবে GitHub Contents API ডাটা লেয়ার হিসেবে।
