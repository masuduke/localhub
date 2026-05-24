import { useState, useRef, useEffect } from "react";

// ─── API CLIENT ───────────────────────────────────────────────────────────
let _accessToken = null;
let _refreshing = null;
function setAccessToken(t) { _accessToken = t; }
function getAccessToken() { return _accessToken; }
function clearTokens() { _accessToken = null; }

async function apiFetch(url, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (_accessToken) headers["Authorization"] = `Bearer ${_accessToken}`;
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  if (res.status === 401 && !options._retry) {
    if (!_refreshing) _refreshing = silentRefresh().finally(() => { _refreshing = null; });
    await _refreshing;
    if (_accessToken) return apiFetch(url, { ...options, _retry: true });
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(json.error || "Request failed"); e.status = res.status; throw e; }
  return json.data;
}

async function silentRefresh() {
  try {
    const data = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" }).then(r => r.json());
    if (data?.data?.accessToken) { _accessToken = data.data.accessToken; return data.data; }
  } catch { _accessToken = null; }
  return null;
}

const API = {
  login: (email, password) => apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  signup: (payload) => apiFetch("/api/auth/signup", { method: "POST", body: JSON.stringify(payload) }),
  logout: () => apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {}),
  me: () => apiFetch("/api/auth/me"),
  refresh: () => silentRefresh(),
  products: (params = {}) => { const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v])=>v))); return apiFetch(`/api/products?${q}`); },
  jobs: (params = {}) => { const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v])=>v))); return apiFetch(`/api/jobs?${q}`); },
  createJob: (payload) => apiFetch("/api/jobs", { method: "POST", body: JSON.stringify(payload) }),
  notifications: () => apiFetch("/api/notifications"),
  markAllRead: () => apiFetch("/api/notifications", { method: "PATCH" }),
  createOrder: (payload) => apiFetch("/api/orders", { method: "POST", body: JSON.stringify(payload) }),
  createIntent: (payload) => apiFetch("/api/payments/create-intent", { method: "POST", body: JSON.stringify(payload) }),
  applyToJob: (jobId, payload) => apiFetch(`/api/jobs/${jobId}/apply`, { method: "POST", body: JSON.stringify(payload) }),
};

function shellCard(extra = {}) {
  return { background: "#ffffff", border: "1px solid #dbe4f0", borderRadius: 14, padding: 18, ...extra };
}

// ══════════════════════════════════════════════════════════════════════════
//  LOCALHUB v6 — Complete Platform
//  NEW in v6:
//  1. Customer loyalty & points  — earn on orders, redeem for discounts
//  2. Promotional banner system  — vendor flash deals, admin approval
//  3. Chat system                — customer↔vendor, customer↔driver
//  4. Referral system            — unique codes, credit on signup
//  5. Vendor analytics dashboard — SVG charts, top products, trends
// ══════════════════════════════════════════════════════════════════════════

const T="#0d9488",TL="#ccfbf1",AM="#f59e0b",NV="#0f172a";
const SL="#64748b",RD="#dc2626",GR="#16a34a",PU="#7c3aed",OR="#ea580c";
const FLAG={uk:"🇬🇧",bd:"🇧🇩"},CUR={uk:"£",bd:"৳"};
const fmt=(p,c)=>c==="uk"?`£${(+p).toFixed(2)}`:`৳${Math.round(+p*130)}`;

// ─── LOYALTY CONFIG ───────────────────────────────────────────────────────
const POINTS_PER_UNIT={uk:10,bd:1}; // 10 pts per £1, 1 pt per ৳1
const POINTS_TO_UNIT={uk:100,bd:1000}; // 100 pts = £1, 1000 pts = ৳1
const getPointsValue=(pts,country)=>+(pts/POINTS_TO_UNIT[country]).toFixed(2);
const getOrderPoints=(total,country)=>Math.floor(total*POINTS_PER_UNIT[country]);

// ─── REFERRAL CODE GENERATOR ─────────────────────────────────────────────
const makeCode=(name)=>(name.slice(0,4).toUpperCase().replace(/\s/g,"")+(Math.random()*9000+1000|0).toString());

// ─── COORDS / DISTANCE ───────────────────────────────────────────────────
const COORDS={
  "east london":[51.513,-0.018],"west ham":[51.532,0.007],"stratford":[51.542,-0.000],
  "canary wharf":[51.505,-0.024],"bethnal green":[51.526,-0.054],"hackney":[51.545,-0.055],
  "bow":[51.527,-0.021],"whitechapel":[51.517,-0.060],"mile end":[51.525,-0.033],
  "gulshan":[23.791,90.414],"banani":[23.794,90.407],"dhanmondi":[23.746,90.374],
  "mirpur":[23.822,90.365],"old dhaka":[23.710,90.407],"uttara":[23.876,90.380],
};
const getCoords=(addr,c)=>{const l=addr.toLowerCase();for(const [k,v] of Object.entries(COORDS))if(l.includes(k))return v;return c==="uk"?[51.520,-0.018]:[23.762,90.400];};
const haversine=([a,b],[c,d],u="miles")=>{const R=u==="miles"?3958.8:6371,dl=(c-a)*Math.PI/180,dm=(d-b)*Math.PI/180,x=Math.sin(dl/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dm/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));};
async function getRoadDist(la1,lo1,la2,lo2,unit="miles"){
  try{const r=await fetch(`https://router.project-osrm.org/route/v1/driving/${lo1},${la1};${lo2},${la2}?overview=false`,{signal:AbortSignal.timeout(4000)});const d=await r.json();if(d.code==="Ok"&&d.routes?.[0]){const km=d.routes[0].distance/1000;return unit==="miles"?+(km*0.621371).toFixed(2):+km.toFixed(2);}}catch(_){}
  return +(haversine([la1,lo1],[la2,lo2],unit)*1.28).toFixed(2);
}
const calcDriverQuote=(dr,dist)=>+Math.max(dr.pricing.min,dr.pricing.base+dist*dr.pricing.perUnit).toFixed(2);
const calcETA=(dist,c)=>Math.round((dist/(c==="uk"?12:19))*60+4);

// ─── SEED DATA ────────────────────────────────────────────────────────────
const SEED_DRIVERS=[
  {id:"dr1",name:"Arif H.",  email:"arif.driver@localhub.com",password:"demo123",country:"uk",avatar:"🛵",vehicle:"Electric Bike",rating:4.9,reviews:[{u:"Sarah",r:5,t:"Super fast!"}],trips:1240,status:"active",isOnline:true,lat:51.532,lng:0.007,pricing:{base:1.50,perUnit:0.60,min:2.50,maxDist:8},earnings:{total:2480,month:340,commission:248},joined:"Jan 2025",badge:"Top Rated"},
  {id:"dr2",name:"Marcus T.",email:"marcus@localhub.com",   password:"demo123",country:"uk",avatar:"🛵",vehicle:"E-Scooter",    rating:4.8,reviews:[{u:"Emma",r:5,t:"5 min!"}],trips:890, status:"active",isOnline:true, lat:51.526,lng:-0.054,pricing:{base:1.80,perUnit:0.55,min:2.80,maxDist:6},earnings:{total:1980,month:290,commission:198},joined:"Feb 2025",badge:"Fastest"},
  {id:"dr3",name:"Priya S.", email:"priya@localhub.com",    password:"demo123",country:"uk",avatar:"🛵",vehicle:"Electric Bike",rating:4.7,reviews:[],trips:2100,status:"active",isOnline:true,lat:51.505,lng:-0.024,pricing:{base:2.00,perUnit:0.50,min:3.00,maxDist:10},earnings:{total:4200,month:510,commission:420},joined:"Nov 2024",badge:"Most Trips"},
  {id:"dr4",name:"রাহেলা",  email:"rahela@localhub.com",   password:"demo123",country:"bd",avatar:"🛵",vehicle:"Electric Bike",rating:4.8,reviews:[{u:"Karim",r:5,t:"দ্রুত!"}],trips:820, status:"active",isOnline:true, lat:23.791,lng:90.414,pricing:{base:40,perUnit:8,min:60,maxDist:10},earnings:{total:48000,month:6200,commission:4800},joined:"Jan 2025",badge:"Top BD"},
];
const DEMO_ACCOUNTS=[
  {id:"a1",email:"admin@localhub.com",     password:"admin123",name:"Alex Admin",      role:"admin",   country:"uk",avatar:"👑",points:0,  referralCode:"ADMIN9999",referralCount:0,credits:0},
  {id:"a2",email:"vendor.uk@localhub.com", password:"demo123", name:"James (UK Shop)", role:"vendor",  country:"uk",avatar:"🏪",points:0,  referralCode:"JAME1234",referralCount:2,credits:5,vendorType:"ecommerce",balance:1240.50,commission_owed:124.05},
  {id:"a3",email:"sarah@localhub.com",     password:"demo123", name:"Sarah (UK)",      role:"customer",country:"uk",avatar:"🛒",points:2450,referralCode:"SARA5678",referralCount:3,credits:12.00,selectedCats:[1,5]},
  {id:"a4",email:"fatima@localhub.com",    password:"demo123", name:"Fatima (BD)",     role:"customer",country:"bd",avatar:"🛍️",points:8900,referralCode:"FATI8901",referralCount:1,credits:0,selectedCats:[2,4]},
  {id:"a5",email:"arif.driver@localhub.com",password:"demo123",name:"Arif (Driver)",  role:"driver",  country:"uk",avatar:"🛵",points:320, referralCode:"ARIF2345",referralCount:1,credits:3.20,driverId:"dr1"},
];
const ALL_ACCOUNTS=[...DEMO_ACCOUNTS,...SEED_DRIVERS.map(d=>({...d,role:"driver",driverId:d.id,points:0,referralCode:makeCode(d.name),referralCount:0,credits:0}))];

const INIT_PRODUCTS=[
  {id:1,country:"uk",vendorId:"a2",name:"Classic White Tee",  price:24.99,emoji:"👕",cat:"Clothing",color:"#e5e7eb",sizes:["S","M","L","XL"],stock:45,reviews:[{u:"Sarah",r:5,t:"Perfect fit!"}],sales:142,revenue:3548.58},
  {id:2,country:"uk",vendorId:"a2",name:"Navy Polo Shirt",    price:34.99,emoji:"🔵",cat:"Clothing",color:"#1e3a5f",sizes:["S","M","L"],   stock:20,reviews:[{u:"Alice",r:5,t:"Love it"}],    sales:89, revenue:3114.11},
  {id:3,country:"uk",vendorId:"a2",name:"Rust Casual Shirt",  price:39.99,emoji:"🟠",cat:"Clothing",color:"#c2410c",sizes:["S","M","L","XL"],stock:15,reviews:[],                                sales:67, revenue:2679.33},
  {id:4,country:"uk",vendorId:"a2",name:"Wool Blazer",        price:89.99,emoji:"🧥",cat:"Clothing",color:"#374151",sizes:["M","L","XL"],  stock:8, reviews:[{u:"Mark",r:4,t:"Smart"}],       sales:34, revenue:3059.66},
  {id:5,country:"uk",vendorId:"a2",name:"Summer Shorts",      price:19.99,emoji:"🩳",cat:"Clothing",color:"#0ea5e9",sizes:["S","M","L","XL"],stock:60,reviews:[],                                sales:201,revenue:4019.99},
  {id:6,country:"uk",vendorId:"v2",name:"Wireless Earbuds",   price:49.99,emoji:"🎧",cat:"Electronics",color:"#1e293b",sizes:[],          stock:30,reviews:[{u:"Emma",r:5,t:"Great sound"}],   sales:56, revenue:2799.44},
  {id:7,country:"bd",vendorId:"a3",name:"লুঙ্গি Classic",    price:8.99, emoji:"🎽",cat:"Traditional",color:"#0f4c81",sizes:["Free"],      stock:100,reviews:[],                               sales:320,revenue:2876.80},
  {id:8,country:"bd",vendorId:"a3",name:"Jamdani Saree",      price:49.99,emoji:"🪭",cat:"Traditional",color:"#be185d",sizes:["Free"],      stock:12,reviews:[{u:"Fatima",r:5,t:"Beautiful!"}],sales:45, revenue:2249.55},
];
const INIT_GROCERY=[
  {id:1,country:"uk",vendorId:"v2",name:"Organic Basmati Rice 5kg",price:8.99,emoji:"🌾",cat:"Staples"},
  {id:2,country:"uk",vendorId:"v2",name:"Free Range Eggs ×12",     price:3.49,emoji:"🥚",cat:"Dairy"},
  {id:3,country:"uk",vendorId:"v2",name:"Sourdough Bread",         price:2.99,emoji:"🍞",cat:"Bakery"},
  {id:4,country:"bd",vendorId:"v3",name:"চাল (Miniket) 5kg",      price:6.49,emoji:"🍚",cat:"Staples"},
  {id:5,country:"bd",vendorId:"v3",name:"ইলিশ মাছ 500g",         price:9.99,emoji:"🐠",cat:"Fish"},
];
const INIT_RESTAURANTS=[
  {id:1,country:"uk",vendorId:"v5",name:"Spice Garden",  cuisine:"Bengali/Indian",rating:4.8,time:"25–35m",emoji:"🍛",reviews:[{u:"Sarah",r:5,t:"Best curry!"}],menu:[{n:"Chicken Biryani",p:12.99},{n:"Lamb Curry",p:13.99},{n:"Garlic Naan",p:1.99}]},
  {id:2,country:"uk",vendorId:"v6",name:"Burger Lab",    cuisine:"American",      rating:4.5,time:"20–30m",emoji:"🍔",reviews:[],menu:[{n:"Smash Burger",p:9.99},{n:"Loaded Fries",p:4.49}]},
  {id:3,country:"bd",vendorId:"v4",name:"ঢাকাই রান্না",cuisine:"Bangladeshi",    rating:4.9,time:"30–40m",emoji:"🍲",reviews:[{u:"Fatima",r:5,t:"অসাধারণ!"}],menu:[{n:"কাচ্চি বিরিয়ানি",p:8.99},{n:"রেজালা",p:7.99}]},
];
const JOB_CATS=[
  {id:1,name:"Bartender",icon:"🍸",count:24},{id:2,name:"Chef/Cook",icon:"👨‍🍳",count:18},
  {id:3,name:"Driver",icon:"🚗",count:45},{id:4,name:"Web Developer",icon:"💻",count:33},
];
const SEED_JOBS=[
  {id:1,country:"uk",catId:1,title:"Experienced Bartender",company:"The Crown Pub",location:"East London",salary:"£12–15/hr",minExp:2,urgent:true,desc:"Fast-paced bar, weekend evenings.",applied:[]},
  {id:2,country:"uk",catId:4,title:"React Developer",      company:"TechFlow Ltd", location:"Stratford",  salary:"£55k–75k",minExp:3,urgent:false,desc:"Growing product team.",applied:[]},
  {id:3,country:"bd",catId:1,title:"বারটেন্ডার দরকার",    company:"Dhaka Hotel",  location:"Gulshan",   salary:"৳25,000/mo",minExp:1,urgent:true,desc:"আন্তর্জাতিক মানের হোটেল।",applied:[]},
];
const DEFAULT_RATES={
  ecommerce:{label:"E-Commerce",type:"percent",value:10},
  grocery:{label:"Grocery",type:"percent",value:10},
  food:{label:"Food Delivery",type:"percent",value:10},
  delivery:{label:"Local Delivery",type:"percent",value:10},
  job_week_uk:{label:"Job Post/Week (UK)",type:"fixed_uk",value:4.99},
  job_week_bd:{label:"Job Post/Week (BD)",type:"fixed_bd",value:299},
};
const SEED_VENDORS=[
  {id:"v1",name:"James Shop UK",country:"uk",type:"ecommerce",sales:1240.50,commission:124.05,status:"active",joined:"Jan 2025"},
  {id:"v2",name:"London Grocery",country:"uk",type:"grocery", sales:890,   commission:89,    status:"active",joined:"Feb 2025"},
  {id:"v3",name:"Rahim Store BD",country:"bd",type:"grocery", sales:65500, commission:6550,  status:"active",joined:"Mar 2025"},
  {id:"v4",name:"Dhaka Foods BD", country:"bd",type:"food",   sales:48200, commission:4820,  status:"pending",joined:"Apr 2025"},
  {id:"v5",name:"Spice Garden UK",country:"uk",type:"food",   sales:3200,  commission:320,   status:"active",joined:"Dec 2024"},
  {id:"v6",name:"Burger Lab UK",  country:"uk",type:"food",   sales:2100,  commission:210,   status:"active",joined:"Jan 2025"},
];
const ADMIN_STATS={
  uk:{users:4821,vendors:142,orders:2341,revenue:48230,commission:4823,drivers:38},
  bd:{users:11240,vendors:318,orders:8912,revenue:2841000,commission:284100,drivers:71},
};

// ─── PROMO SEED DATA ──────────────────────────────────────────────────────
const INIT_PROMOS=[
  {id:"p1",vendorId:"a2",vendorName:"James Shop UK",title:"Summer Flash Sale",desc:"20% off all clothing today only!",discount:20,type:"percent",minOrder:30,category:"Clothing",country:"uk",status:"active",expiresIn:14400,emoji:"🔥",color:"#dc2626",createdAt:"Today"},
  {id:"p2",vendorId:"v5",vendorName:"Spice Garden",  title:"Lunch Special",desc:"£3 off orders over £20. Weekdays 12–3pm.",discount:3,type:"fixed",minOrder:20,category:"Food",country:"uk",status:"active",expiresIn:7200,emoji:"🍛",color:"#ea580c",createdAt:"Today"},
  {id:"p3",vendorId:"v3",vendorName:"Rahim Store BD",title:"রমজান অফার",desc:"All grocery items 15% off this week.",discount:15,type:"percent",minOrder:500,category:"Grocery",country:"bd",status:"active",expiresIn:259200,emoji:"🌙",color:"#0d9488",createdAt:"Yesterday"},
  {id:"p4",vendorId:"v6",vendorName:"Burger Lab",    title:"Student Deal",desc:"Show your student card, get 25% off.",discount:25,type:"percent",minOrder:8,category:"Food",country:"uk",status:"pending",expiresIn:86400,emoji:"🎓",color:"#7c3aed",createdAt:"Today"},
];

// ─── CHAT SEED MESSAGES ───────────────────────────────────────────────────
const INIT_CHATS={
  "sarah-james":[
    {id:1,from:"a3",text:"Hi! Do you have the Classic White Tee in size M?",time:"10:32 AM",read:true},
    {id:2,from:"a2",text:"Yes! We have it in stock. Shall I set one aside for you?",time:"10:34 AM",read:true},
    {id:3,from:"a3",text:"Yes please! Can I get it delivered today?",time:"10:35 AM",read:true},
    {id:4,from:"a2",text:"Absolutely, same-day delivery is available before 3pm. Go ahead and order through the app!",time:"10:37 AM",read:false},
  ],
  "sarah-arif":[
    {id:1,from:"dr1",text:"Hi Sarah! I'm your driver for order ORD-A1B2C3. I'm 5 minutes away.",time:"2:18 PM",read:true},
    {id:2,from:"a3",text:"Great! I'll be by the front door.",time:"2:19 PM",read:true},
    {id:3,from:"dr1",text:"Arrived! 🛵 Parcel handed over. Have a great day!",time:"2:23 PM",read:false},
  ],
};

// ─── REFERRAL HISTORY ─────────────────────────────────────────────────────
const INIT_REFERRALS={
  "a3":[
    {id:"r1",name:"Tom H.",joined:"3 days ago",reward:5.00,status:"credited"},
    {id:"r2",name:"Alice B.",joined:"1 week ago",reward:5.00,status:"credited"},
    {id:"r3",name:"Mike R.",joined:"2 weeks ago",reward:5.00,status:"credited"},
  ],
  "a2":[
    {id:"r1",name:"Emma K.",joined:"2 weeks ago",reward:5.00,status:"credited"},
    {id:"r2",name:"James P.",joined:"1 month ago",reward:5.00,status:"credited"},
  ],
};

// ─── POINTS HISTORY ───────────────────────────────────────────────────────
const INIT_POINTS_HISTORY={
  "a3":[
    {id:"ph1",desc:"Order ORD-A1B2C3",type:"earn",pts:850,date:"Today"},
    {id:"ph2",desc:"Order ORD-D4E5F6",type:"earn",pts:900,date:"Yesterday"},
    {id:"ph3",desc:"Referral bonus (Tom H.)",type:"earn",pts:500,date:"3 days ago"},
    {id:"ph4",desc:"Redeemed for discount",type:"redeem",pts:-800,date:"4 days ago"},
    {id:"ph5",desc:"Order ORD-G7H8I9",type:"earn",pts:750,date:"1 week ago"},
    {id:"ph6",desc:"Referral bonus (Alice B.)",type:"earn",pts:500,date:"1 week ago"},
  ],
  "a4":[
    {id:"ph1",desc:"Order ORD-B2C3D4",type:"earn",pts:5800,date:"Today"},
    {id:"ph2",desc:"Order ORD-E5F6G7",type:"earn",pts:2100,date:"2 days ago"},
    {id:"ph3",desc:"Referral bonus",type:"earn",pts:500,date:"5 days ago"},
    {id:"ph4",desc:"Order ORD-H8I9J0",type:"earn",pts:500,date:"1 week ago"},
  ],
};

// ─── VENDOR ANALYTICS SEED ───────────────────────────────────────────────
const VENDOR_WEEKLY={
  sales:[3200,2800,4100,3600,5200,4800,6100,5400],
  orders:[28,24,35,31,44,40,52,46],
  customers:[22,18,28,24,36,32,41,38],
  labels:["W1","W2","W3","W4","W5","W6","W7","W8"],
};

// ─── SHARED UI ────────────────────────────────────────────────────────────
const card=(e={})=>({background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",padding:"20px",...e});
const Pill=({children,bg=TL,color=T,style={}})=>(
  <span style={{background:bg,color,fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,...style}}>{children}</span>
);
const Btn=({children,onClick,primary,danger,warning,small,full,disabled,style={}})=>(
  <button onClick={onClick} disabled={disabled} style={{
    background:danger?"#fee2e2":warning?"#fff7ed":primary?T:"#fff",
    color:danger?RD:warning?OR:primary?"#fff":T,
    border:`1.5px solid ${danger?RD:warning?OR:T}`,
    borderRadius:9,padding:small?"6px 14px":full?"12px":"10px 22px",
    fontWeight:700,fontSize:small?12:14,cursor:disabled?"not-allowed":"pointer",
    opacity:disabled?.5:1,width:full?"100%":"auto",transition:"all .15s",...style
  }}>{children}</button>
);
const Inp=({label,...p})=>(
  <div style={{marginBottom:14}}>
    {label&&<div style={{fontSize:12,fontWeight:700,color:SL,marginBottom:5}}>{label}</div>}
    <input {...p} style={{width:"100%",padding:"10px 14px",border:"1.5px solid #e2e8f0",borderRadius:10,fontSize:14,fontFamily:"inherit",...(p.style||{})}}/>
  </div>
);
const Sel=({label,options,...p})=>(
  <div style={{marginBottom:14}}>
    {label&&<div style={{fontSize:12,fontWeight:700,color:SL,marginBottom:5}}>{label}</div>}
    <select {...p} style={{width:"100%",padding:"10px 14px",border:"1.5px solid #e2e8f0",borderRadius:10,fontSize:14,fontFamily:"inherit",background:"#fff"}}>
      {options.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  </div>
);
const SBadge=({s})=>{
  const m={active:["#dcfce7","#15803d","Active"],pending:["#fef9c3","#a16207","Pending"],suspended:["#fee2e2",RD,"Suspended"],approved:["#dcfce7","#15803d","Approved"],rejected:["#fee2e2",RD,"Rejected"]};
  const [bg,col,txt]=m[s]||m.pending;
  return <Pill bg={bg} color={col}>{txt}</Pill>;
};
const StatBox=({icon,label,value,sub,color=T})=>(
  <div style={{...card(),borderTop:`3px solid ${color}`}}>
    <div style={{fontSize:24,marginBottom:5}}>{icon}</div>
    <div style={{fontSize:19,fontWeight:800,color:NV}}>{value}</div>
    <div style={{fontSize:12,fontWeight:600,color:SL}}>{label}</div>
    {sub&&<div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>{sub}</div>}
  </div>
);
const StarDisp=({r,count})=>(
  <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
    <span style={{color:AM,fontSize:12,fontWeight:700}}>★ {(+r).toFixed(1)}</span>
    {count!=null&&<span style={{fontSize:11,color:SL}}>({count})</span>}
  </span>
);

// ─── COUNTDOWN TIMER ─────────────────────────────────────────────────────
function Countdown({seconds}){
  const [rem,setRem]=useState(seconds);
  useEffect(()=>{const iv=setInterval(()=>setRem(r=>Math.max(0,r-1)),1000);return()=>clearInterval(iv);},[]);
  const h=Math.floor(rem/3600),m=Math.floor((rem%3600)/60),s=rem%60;
  return <span style={{fontFeatureSettings:'"tnum"',fontVariantNumeric:"tabular-nums"}}>{h>0?`${h}h `:""}{ m>0?`${m}m `:""}{ s}s</span>;
}

// ─── SVG LINE CHART ───────────────────────────────────────────────────────
function LineChart({data,labels,color=T,cur,title,height=160}){
  const [hov,setHov]=useState(null);
  const W=500,H=height,P={top:16,right:16,bottom:28,left:52};
  const pw=W-P.left-P.right,ph=H-P.top-P.bottom;
  const max=Math.max(...data),min=Math.min(...data)*0.9;
  const x=(i)=>P.left+i*(pw/(data.length-1));
  const y=(v)=>P.top+ph*(1-(v-min)/(max-min));
  const path=data.map((v,i)=>`${i===0?"M":"L"}${x(i)},${y(v)}`).join(" ");
  const area=`${path} L${x(data.length-1)},${P.top+ph} L${x(0)},${P.top+ph} Z`;
  return(
    <div>
      {title&&<div style={{fontWeight:700,fontSize:14,color:NV,marginBottom:8}}>{title}</div>}
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}}>
        {[0,.25,.5,.75,1].map((f,i)=>{
          const yv=min+(max-min)*f;
          return <g key={i}>
            <line x1={P.left} y1={y(yv)} x2={W-P.right} y2={y(yv)} stroke="#f1f5f9" strokeWidth="1"/>
            <text x={P.left-5} y={y(yv)+4} textAnchor="end" fontSize="8" fill="#94a3b8">{cur}{Math.round(yv)}</text>
          </g>;
        })}
        <defs><linearGradient id={`grad-${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.15"/>
          <stop offset="100%" stopColor={color} stopOpacity="0.01"/>
        </linearGradient></defs>
        <path d={area} fill={`url(#grad-${color.slice(1)})`}/>
        <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
        {data.map((v,i)=>(
          <g key={i} onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)} style={{cursor:"pointer"}}>
            <circle cx={x(i)} cy={y(v)} r={hov===i?7:5} fill={color} stroke="#fff" strokeWidth="2"/>
            <text x={x(i)} y={H-P.bottom+14} textAnchor="middle" fontSize="9" fill={SL}>{labels[i]}</text>
            {hov===i&&<>
              <rect x={x(i)-28} y={y(v)-32} width={56} height={20} rx={5} fill={NV} opacity=".9"/>
              <text x={x(i)} y={y(v)-18} textAnchor="middle" fontSize="9" fill="#fff" fontWeight="bold">{cur}{v.toLocaleString()}</text>
            </>}
          </g>
        ))}
      </svg>
    </div>
  );
}

// ─── BAR CHART ────────────────────────────────────────────────────────────
function BarChart({data,labels,color=T,title,height=140}){
  const [hov,setHov]=useState(null);
  const W=500,H=height,P={top:12,right:12,bottom:28,left:40};
  const pw=W-P.left-P.right,ph=H-P.top-P.bottom;
  const max=Math.max(...data);
  const bw=(pw/data.length)*0.6,bg=(pw/data.length)*0.4;
  const x=(i)=>P.left+i*(pw/data.length)+bg/2;
  const barH=(v)=>ph*(v/max);
  return(
    <div>
      {title&&<div style={{fontWeight:700,fontSize:14,color:NV,marginBottom:8}}>{title}</div>}
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}}>
        {data.map((v,i)=>(
          <g key={i} onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)} style={{cursor:"pointer"}}>
            <rect x={x(i)} y={P.top+ph-barH(v)} width={bw} height={barH(v)} rx={4}
              fill={hov===i?color+"cc":color+"88"}/>
            <text x={x(i)+bw/2} y={H-P.bottom+14} textAnchor="middle" fontSize="9" fill={SL}>{labels[i]}</text>
            {hov===i&&<>
              <rect x={x(i)-5} y={P.top+ph-barH(v)-22} width={bw+10} height={18} rx={4} fill={NV} opacity=".9"/>
              <text x={x(i)+bw/2} y={P.top+ph-barH(v)-9} textAnchor="middle" fontSize="9" fill="#fff">{v}</text>
            </>}
          </g>
        ))}
        <line x1={P.left} y1={P.top+ph} x2={W-P.right} y2={P.top+ph} stroke="#e2e8f0" strokeWidth="1"/>
      </svg>
    </div>
  );
}

// ─── NOTIFICATION BELL ───────────────────────────────────────────────────
function NotifBell({notifs,onMarkRead,onMarkAll,onClear}){
  const [open,setOpen]=useState(false);
  const unread=notifs.filter(n=>!n.read).length;
  const ref=useRef();
  useEffect(()=>{const h=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[]);
  return(
    <div ref={ref} style={{position:"relative"}}>
      <button onClick={()=>setOpen(o=>!o)} style={{background:"none",border:"1px solid #334155",color:"#94a3b8",borderRadius:8,padding:"5px 10px",cursor:"pointer",fontSize:15,position:"relative"}}>
        🔔{unread>0&&<span style={{position:"absolute",top:-5,right:-5,background:RD,color:"#fff",fontSize:9,fontWeight:800,borderRadius:10,padding:"1px 5px",minWidth:16,textAlign:"center"}}>{unread}</span>}
      </button>
      {open&&(
        <div style={{position:"absolute",top:"calc(100% + 8px)",right:0,background:"#fff",borderRadius:16,border:"1px solid #e2e8f0",boxShadow:"0 16px 48px rgba(0,0,0,.18)",width:320,zIndex:1000,overflow:"hidden"}}>
          <div style={{padding:"12px 16px",borderBottom:"1px solid #f1f5f9",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{fontWeight:800,fontSize:14,color:NV}}>Notifications {unread>0&&<span style={{color:RD,fontSize:12}}>({unread})</span>}</div>
            <div style={{display:"flex",gap:8}}>
              {unread>0&&<button onClick={onMarkAll} style={{background:"none",border:"none",color:T,fontSize:11,fontWeight:600,cursor:"pointer"}}>All read</button>}
              <button onClick={onClear} style={{background:"none",border:"none",color:"#94a3b8",fontSize:11,cursor:"pointer"}}>Clear</button>
            </div>
          </div>
          <div style={{maxHeight:320,overflowY:"auto"}}>
            {notifs.length===0&&<div style={{padding:"28px 16px",textAlign:"center",color:"#94a3b8",fontSize:13}}>No notifications</div>}
            {notifs.map(n=>(
              <div key={n.id} onClick={()=>onMarkRead(n.id)} style={{padding:"10px 14px",borderBottom:"1px solid #f8fafc",cursor:"pointer",background:n.read?"#fff":"#f8fafc",display:"flex",gap:10}}>
                <div style={{width:32,height:32,borderRadius:9,background:"#f1f5f9",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>{n.icon}</div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:12,color:NV,marginBottom:2}}>{n.title}{!n.read&&<span style={{display:"inline-block",width:6,height:6,borderRadius:"50%",background:RD,marginLeft:5,verticalAlign:"middle"}}/>}</div>
                  <div style={{fontSize:11,color:SL,lineHeight:1.4}}>{n.body}</div>
                  <div style={{fontSize:10,color:"#94a3b8",marginTop:2}}>{n.time}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── LIVE MAP ─────────────────────────────────────────────────────────────
function LiveMap({drivers,country,style={}}){
  const [pos,setPos]=useState(()=>drivers.map(d=>({id:d.id,lat:d.lat,lng:d.lng})));
  const [tick,setTick]=useState(0);
  useEffect(()=>{const iv=setInterval(()=>{setPos(p=>p.map(dp=>{const dr=drivers.find(d=>d.id===dp.id);if(!dr?.isOnline)return dp;const j=0.0004;return{...dp,lat:dp.lat+(Math.random()-.5)*j,lng:dp.lng+(Math.random()-.5)*j};}));setTick(t=>t+1);},[],1200);return()=>clearInterval(iv);},[drivers]);
  const bounds=country==="uk"?{minLat:51.48,maxLat:51.58,minLng:-0.11,maxLng:0.13}:{minLat:23.69,maxLat:23.90,minLng:90.34,maxLng:90.46};
  const W=560,H=220;
  const toX=lng=>((lng-bounds.minLng)/(bounds.maxLng-bounds.minLng))*W;
  const toY=lat=>(1-(lat-bounds.minLat)/(bounds.maxLat-bounds.minLat))*H;
  const online=pos.filter(dp=>drivers.find(d=>d.id===dp.id)?.isOnline&&drivers.find(d=>d.id===dp.id)?.status==="active");
  return(
    <div style={{...card({padding:0,overflow:"hidden"}),...style}}>
      <div style={{padding:"10px 14px",borderBottom:"1px solid #f1f5f9",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{fontWeight:700,fontSize:13,color:NV}}>🗺️ Live Drivers — {FLAG[country]}</div>
        <Pill bg="#dcfce7" color={GR} style={{fontSize:10}}>🟢 {online.length} online</Pill>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block",background:"#f8fafc"}}>
        {[...Array(6)].map((_,i)=><line key={i} x1={i*(W/5)} y1={0} x2={i*(W/5)} y2={H} stroke="#e2e8f0" strokeWidth="1"/>)}
        {[...Array(5)].map((_,i)=><line key={i} x1={0} y1={i*(H/4)} x2={W} y2={i*(H/4)} stroke="#e2e8f0" strokeWidth="1"/>)}
        {online.map(dp=>{const dr=drivers.find(d=>d.id===dp.id);return(
          <g key={dp.id}>
            <circle cx={toX(dp.lng)} cy={toY(dp.lat)} r={12} fill="none" stroke={GR} strokeWidth="1.5" opacity={0.3+(tick%2)*0.25}/>
            <circle cx={toX(dp.lng)} cy={toY(dp.lat)} r={8} fill={GR} stroke="#fff" strokeWidth="2"/>
            <text x={toX(dp.lng)} y={toY(dp.lat)+3.5} textAnchor="middle" fontSize="8" fill="#fff">🛵</text>
            <rect x={toX(dp.lng)-15} y={toY(dp.lat)-22} width={30} height={11} rx={3} fill={NV} opacity=".85"/>
            <text x={toX(dp.lng)} y={toY(dp.lat)-14} textAnchor="middle" fontSize="6.5" fill="#fff" fontFamily="sans-serif">{dr?.name.split(" ")[0]}</text>
          </g>
        );})}
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  LOYALTY WIDGET (header)
// ═══════════════════════════════════════════════════════════════════════════
function LoyaltyBadge({points,country,onClick}){
  const val=getPointsValue(points,country),cur=CUR[country];
  return(
    <button onClick={onClick} style={{background:"linear-gradient(135deg,#fef3c7,#fde68a)",border:"1.5px solid #fbbf24",borderRadius:20,padding:"4px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,fontFamily:"inherit"}}>
      <span style={{fontSize:14}}>⭐</span>
      <span style={{fontWeight:800,fontSize:12,color:"#92400e"}}>{points.toLocaleString()} pts</span>
      <span style={{fontSize:10,color:"#a16207"}}>≈ {cur}{val}</span>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  PROMO BANNER STRIP
// ═══════════════════════════════════════════════════════════════════════════
function PromoBanners({promos,country,user,onApply,appliedPromo}){
  const active=promos.filter(p=>p.country===country&&p.status==="active");
  if(active.length===0) return null;
  return(
    <div style={{display:"flex",gap:10,overflowX:"auto",paddingBottom:4,marginBottom:16}}>
      {active.map(p=>(
        <div key={p.id} style={{background:`linear-gradient(135deg,${p.color}18,${p.color}08)`,border:`1.5px solid ${p.color}44`,borderRadius:14,padding:"12px 16px",minWidth:240,flexShrink:0,position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",right:-10,top:-10,fontSize:48,opacity:.08}}>{p.emoji}</div>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
            <span style={{fontSize:20}}>{p.emoji}</span>
            <div style={{fontWeight:800,fontSize:13,color:NV}}>{p.title}</div>
          </div>
          <div style={{fontSize:12,color:SL,marginBottom:8,lineHeight:1.4}}>{p.desc}</div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:6}}>
            <div>
              <Pill bg={`${p.color}22`} color={p.color} style={{fontSize:11}}>{p.type==="percent"?`${p.discount}% OFF`:`${CUR[country]}${p.discount} OFF`}</Pill>
              <span style={{fontSize:10,color:"#94a3b8",marginLeft:6}}>Min {CUR[country]}{p.minOrder}</span>
            </div>
            <div style={{fontSize:10,color:"#94a3b8",display:"flex",alignItems:"center",gap:3}}>
              ⏱ <Countdown seconds={p.expiresIn}/>
            </div>
          </div>
          {user&&(
            <button onClick={()=>onApply(appliedPromo?.id===p.id?null:p)} style={{marginTop:8,background:appliedPromo?.id===p.id?GR:p.color,border:"none",color:"#fff",borderRadius:8,padding:"5px 12px",fontSize:11,fontWeight:700,cursor:"pointer",width:"100%"}}>
              {appliedPromo?.id===p.id?"✓ Applied!":"Apply Deal"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  CHAT SYSTEM
// ═══════════════════════════════════════════════════════════════════════════
function ChatPanel({user,onClose}){
  const [activeConv,setActiveConv]=useState(null);
  const [chats,setChats]=useState(INIT_CHATS);
  const [newMsg,setNewMsg]=useState("");
  const [newConvModal,setNewConv]=useState(false);
  const messagesEndRef=useRef();

  const CONVERSATIONS=[
    {id:"sarah-james",  label:"James Shop UK", avatar:"🏪",role:"Vendor",   lastMsg:"Shall I set one aside?",unread:1},
    {id:"sarah-arif",   label:"Arif H.",       avatar:"🛵",role:"Driver",   lastMsg:"Parcel handed over!",   unread:1},
    {id:"sarah-support",label:"LocalHub Support",avatar:"🌐",role:"Support", lastMsg:"How can we help?",      unread:0},
  ];

  useEffect(()=>{messagesEndRef.current?.scrollIntoView({behavior:"smooth"});},[activeConv,chats]);

  const sendMessage=()=>{
    if(!newMsg.trim()||!activeConv) return;
    const msg={id:Date.now(),from:user.id,text:newMsg.trim(),time:new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}),read:false};
    setChats(c=>({...c,[activeConv]:[...(c[activeConv]||[]),msg]}));
    setNewMsg("");
    // Simulate reply after 2s
    setTimeout(()=>{
      const replies=["Got it! 👍","Thanks for letting me know.","I'll check and get back to you shortly!","On my way! 🛵","No problem at all."];
      const reply={id:Date.now()+1,from:"bot",text:replies[Math.floor(Math.random()*replies.length)],time:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),read:false};
      setChats(c=>({...c,[activeConv]:[...(c[activeConv]||[]),reply]}));
    },2000);
  };

  const activeMessages=activeConv?chats[activeConv]||[]:[];
  const activeInfo=CONVERSATIONS.find(c=>c.id===activeConv);

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.8)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"#fff",borderRadius:20,width:"100%",maxWidth:660,height:560,display:"flex",overflow:"hidden",animation:"fadeIn .2s ease",boxShadow:"0 24px 60px rgba(0,0,0,.3)"}}>
        {/* Sidebar */}
        <div style={{width:220,borderRight:"1px solid #f1f5f9",display:"flex",flexDirection:"column",flexShrink:0}}>
          <div style={{padding:"16px 14px",borderBottom:"1px solid #f1f5f9",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:15,color:NV}}>Messages</div>
            <button onClick={()=>setNewConv(true)} style={{background:TL,border:"none",color:T,borderRadius:8,padding:"4px 9px",cursor:"pointer",fontSize:13,fontWeight:700}}>+</button>
          </div>
          <div style={{flex:1,overflowY:"auto"}}>
            {CONVERSATIONS.map(conv=>(
              <div key={conv.id} onClick={()=>setActiveConv(conv.id)} style={{padding:"12px 14px",borderBottom:"1px solid #f8fafc",cursor:"pointer",background:activeConv===conv.id?"#f0fdf4":"#fff",display:"flex",gap:10,alignItems:"center"}}>
                <div style={{width:36,height:36,borderRadius:"50%",background:TL,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{conv.avatar}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:12,color:NV,marginBottom:1}}>{conv.label}</div>
                  <div style={{fontSize:10,color:SL,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{conv.lastMsg}</div>
                </div>
                {conv.unread>0&&<span style={{background:T,color:"#fff",borderRadius:"50%",width:16,height:16,fontSize:9,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,flexShrink:0}}>{conv.unread}</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Chat area */}
        <div style={{flex:1,display:"flex",flexDirection:"column"}}>
          {!activeConv?(
            <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:"#94a3b8"}}>
              <div style={{fontSize:48,marginBottom:12}}>💬</div>
              <div style={{fontSize:14,fontWeight:600,color:SL}}>Select a conversation</div>
              <div style={{fontSize:12,marginTop:4}}>or start a new one</div>
            </div>
          ):(
            <>
              {/* Header */}
              <div style={{padding:"12px 16px",borderBottom:"1px solid #f1f5f9",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:34,height:34,borderRadius:"50%",background:TL,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>{activeInfo?.avatar}</div>
                  <div><div style={{fontWeight:700,fontSize:13,color:NV}}>{activeInfo?.label}</div>
                    <div style={{fontSize:10,color:GR}}>● Online</div></div>
                </div>
                <button onClick={onClose} style={{border:"none",background:"none",cursor:"pointer",fontSize:20,color:"#94a3b8"}}>✕</button>
              </div>
              {/* Messages */}
              <div style={{flex:1,overflowY:"auto",padding:"16px",display:"flex",flexDirection:"column",gap:10}}>
                {activeMessages.map(msg=>{
                  const isMe=msg.from===user.id;
                  return(
                    <div key={msg.id} style={{display:"flex",justifyContent:isMe?"flex-end":"flex-start"}}>
                      <div style={{maxWidth:"75%",background:isMe?T:"#f1f5f9",color:isMe?"#fff":NV,borderRadius:isMe?"14px 14px 2px 14px":"14px 14px 14px 2px",padding:"9px 13px",fontSize:13,lineHeight:1.5}}>
                        {msg.text}
                        <div style={{fontSize:9,opacity:.7,marginTop:4,textAlign:"right"}}>{msg.time}</div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef}/>
              </div>
              {/* Input */}
              <div style={{padding:"12px 14px",borderTop:"1px solid #f1f5f9",display:"flex",gap:8}}>
                <input value={newMsg} onChange={e=>setNewMsg(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendMessage()}
                  placeholder="Type a message..." style={{flex:1,padding:"9px 14px",border:"1.5px solid #e2e8f0",borderRadius:20,fontSize:13,fontFamily:"inherit"}}/>
                <button onClick={sendMessage} style={{background:T,border:"none",color:"#fff",borderRadius:"50%",width:38,height:38,cursor:"pointer",fontSize:17,flexShrink:0}}>→</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  LOYALTY PAGE
// ═══════════════════════════════════════════════════════════════════════════
function LoyaltyPage({user,setUser,country}){
  const cur=CUR[country];
  const points=user.points||0;
  const history=INIT_POINTS_HISTORY[user.id]||[];
  const credits=user.credits||0;
  const pointsValue=getPointsValue(points,country);
  const TIERS=[
    {name:"Bronze",icon:"🥉",min:0,    max:999, color:"#cd7f32",perks:["1x points multiplier","Standard support"]},
    {name:"Silver",icon:"🥈",min:1000, max:4999,color:"#94a3b8",perks:["1.5x points multiplier","Priority support","Early access to deals"]},
    {name:"Gold",  icon:"🥇",min:5000, max:9999,color:AM,        perks:["2x points multiplier","Free delivery once/week","Exclusive vendor deals"]},
    {name:"Platinum",icon:"💎",min:10000,max:Infinity,color:"#06b6d4",perks:["3x points multiplier","Free delivery always","Personal account manager","Beta features access"]},
  ];
  const tier=TIERS.find(t=>points>=t.min&&points<=t.max)||TIERS[0];
  const nextTier=TIERS[TIERS.indexOf(tier)+1];
  const progress=nextTier?((points-tier.min)/(nextTier.min-tier.min))*100:100;

  const [redeemPts,setRedeemPts]=useState(500);
  const [redeemed,setRedeemed]=useState(false);
  const doRedeem=()=>{
    if(redeemPts>points) return;
    setUser(u=>({...u,points:u.points-redeemPts,credits:(u.credits||0)+getPointsValue(redeemPts,country)}));
    setRedeemed(true);
    setTimeout(()=>setRedeemed(false),2500);
  };

  return(
    <div>
      <h2 style={{fontFamily:"Syne,sans-serif",fontSize:24,fontWeight:800,color:NV,marginBottom:4}}>⭐ Loyalty Rewards</h2>
      <p style={{color:SL,fontSize:13,marginBottom:18}}>Earn {POINTS_PER_UNIT[country]} points per {CUR[country]}1 spent · Redeem for discounts · Higher tiers = bigger rewards</p>

      {/* Points balance card */}
      <div style={{background:`linear-gradient(135deg,${tier.color}22,${tier.color}08)`,border:`2px solid ${tier.color}44`,borderRadius:20,padding:"24px 28px",marginBottom:18,position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",right:-20,top:-20,fontSize:100,opacity:.07}}>{tier.icon}</div>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:16}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
              <span style={{fontSize:28}}>{tier.icon}</span>
              <Pill bg={`${tier.color}22`} color={tier.color} style={{fontSize:13}}>{tier.name} Member</Pill>
            </div>
            <div style={{fontSize:40,fontWeight:800,color:NV,fontVariantNumeric:"tabular-nums"}}>{points.toLocaleString()} <span style={{fontSize:18,color:SL}}>pts</span></div>
            <div style={{fontSize:14,color:SL,marginTop:4}}>Worth <strong style={{color:T}}>{cur}{pointsValue}</strong> in discounts</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div style={{background:"#fff",borderRadius:14,padding:"14px 18px",textAlign:"center",minWidth:140,boxShadow:"0 2px 8px rgba(0,0,0,.06)"}}>
              <div style={{fontSize:11,color:SL,fontWeight:600,marginBottom:3}}>CREDITS BALANCE</div>
              <div style={{fontSize:22,fontWeight:800,color:GR}}>{cur}{credits.toFixed(2)}</div>
              <div style={{fontSize:10,color:"#94a3b8"}}>Ready to use at checkout</div>
            </div>
          </div>
        </div>
        {/* Progress to next tier */}
        {nextTier&&<div style={{marginTop:16}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:SL,marginBottom:5}}>
            <span>{tier.name}</span>
            <span>{nextTier.name}: {nextTier.min.toLocaleString()} pts needed</span>
          </div>
          <div style={{background:"#e2e8f0",borderRadius:8,height:8,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${Math.min(100,progress)}%`,background:tier.color,borderRadius:8,transition:"width 1s ease"}}/>
          </div>
          <div style={{fontSize:11,color:SL,marginTop:4}}>{(nextTier.min-points).toLocaleString()} pts to unlock {nextTier.name}</div>
        </div>}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:18}}>
        {/* Redeem points */}
        <div style={{...card()}}>
          <div style={{fontWeight:700,fontSize:15,color:NV,marginBottom:4}}>🎁 Redeem Points</div>
          <p style={{color:SL,fontSize:13,marginBottom:14}}>Convert points to credit. Min 500 pts.</p>
          <div style={{display:"flex",gap:8,marginBottom:10}}>
            {[500,1000,2000,5000].map(v=>(
              <button key={v} onClick={()=>setRedeemPts(v)} disabled={v>points}
                style={{flex:1,border:`1.5px solid ${redeemPts===v?T:"#e2e8f0"}`,background:redeemPts===v?TL:"#fff",color:redeemPts===v?T:v>points?"#94a3b8":NV,borderRadius:8,padding:"6px 4px",fontSize:11,fontWeight:600,cursor:v>points?"not-allowed":"pointer",opacity:v>points?.5:1}}>
                {v.toLocaleString()}
              </button>
            ))}
          </div>
          <div style={{background:"#f8fafc",borderRadius:10,padding:"10px 14px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:13,color:SL}}>{redeemPts.toLocaleString()} pts →</span>
            <span style={{fontSize:16,fontWeight:800,color:T}}>{cur}{getPointsValue(redeemPts,country)}</span>
          </div>
          <Btn primary full onClick={doRedeem} disabled={redeemPts>points||redeemed}>
            {redeemed?"✅ Redeemed!":"Redeem Now"}
          </Btn>
        </div>

        {/* Tier perks */}
        <div style={{...card()}}>
          <div style={{fontWeight:700,fontSize:15,color:NV,marginBottom:12}}>🏆 Your Tier Perks</div>
          {tier.perks.map((p,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:i<tier.perks.length-1?"1px solid #f8fafc":"none"}}>
              <span style={{color:GR,fontSize:14}}>✓</span>
              <span style={{fontSize:13,color:NV}}>{p}</span>
            </div>
          ))}
          {nextTier&&<div style={{marginTop:10,background:"#f8fafc",borderRadius:8,padding:"8px 10px",fontSize:11,color:SL}}>
            Unlock {nextTier.icon} {nextTier.name}: {nextTier.perks[0]}
          </div>}
        </div>
      </div>

      {/* Points history */}
      <div style={{...card()}}>
        <div style={{fontWeight:700,fontSize:15,color:NV,marginBottom:14}}>📋 Points History</div>
        {history.length===0&&<div style={{color:"#94a3b8",fontSize:13,textAlign:"center",padding:20}}>No transactions yet.</div>}
        {history.map(h=>(
          <div key={h.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"1px solid #f8fafc"}}>
            <div style={{width:34,height:34,borderRadius:10,background:h.type==="earn"?"#dcfce7":"#fee2e2",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{h.type==="earn"?"⬆":"⬇"}</div>
            <div style={{flex:1}}>
              <div style={{fontWeight:600,fontSize:13,color:NV}}>{h.desc}</div>
              <div style={{fontSize:11,color:"#94a3b8"}}>{h.date}</div>
            </div>
            <div style={{fontWeight:800,fontSize:15,color:h.type==="earn"?GR:RD}}>
              {h.type==="earn"?"+":""}{h.pts.toLocaleString()} pts
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  REFERRAL PAGE
// ═══════════════════════════════════════════════════════════════════════════
function ReferralPage({user,country,setUser,fire}){
  const cur=CUR[country];
  const code=user.referralCode||makeCode(user.name);
  const history=INIT_REFERRALS[user.id]||[];
  const totalEarned=history.reduce((s,r)=>s+r.reward,0);
  const [copied,setCopied]=useState(false);
  const [applyCode,setApplyCode]=useState("");
  const [applyResult,setApplyResult]=useState(null);

  const copy=()=>{navigator.clipboard?.writeText(code);setCopied(true);setTimeout(()=>setCopied(false),2000);};
  const applyReferral=()=>{
    if(!applyCode.trim()){return;}
    if(applyCode.toUpperCase()===code){setApplyResult({success:false,msg:"You can't use your own referral code."});return;}
    const bonus=country==="uk"?5:500;
    setUser(u=>({...u,points:(u.points||0)+bonus,credits:(u.credits||0)+(country==="uk"?bonus:0)}));
    setApplyResult({success:true,msg:`🎉 Referral applied! You earned ${cur}${bonus} credit and ${bonus} bonus points!`});
    fire&&fire(`🎉 Referral code applied! +${bonus} points earned!`);
  };

  const shareLink=`https://localhub.app/join?ref=${code}`;

  return(
    <div>
      <h2 style={{fontFamily:"Syne,sans-serif",fontSize:24,fontWeight:800,color:NV,marginBottom:4}}>🔗 Refer & Earn</h2>
      <p style={{color:SL,fontSize:13,marginBottom:18}}>Share your code — you and your friend both earn {cur}{country==="uk"?"5.00":"500"} credit when they place their first order.</p>

      {/* Code card */}
      <div style={{background:`linear-gradient(135deg,${T},#0891b2)`,borderRadius:20,padding:"28px",marginBottom:18,color:"#fff",textAlign:"center",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",inset:0,background:"url(\"data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Ccircle fill='rgba(255,255,255,.04)' cx='20' cy='20' r='15'/%3E%3C/g%3E%3C/svg%3E\")"}}/>
        <div style={{fontSize:14,color:"rgba(255,255,255,.8)",marginBottom:6}}>Your Referral Code</div>
        <div style={{fontFamily:"Syne,sans-serif",fontSize:36,fontWeight:800,letterSpacing:4,marginBottom:16}}>{code}</div>
        <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
          <button onClick={copy} style={{background:"rgba(255,255,255,.2)",border:"1.5px solid rgba(255,255,255,.4)",color:"#fff",borderRadius:10,padding:"9px 20px",cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"inherit"}}>
            {copied?"✓ Copied!":"📋 Copy Code"}
          </button>
          <button onClick={()=>navigator.share?.({title:"Join LocalHub",text:`Use my code ${code} to get ${cur}5 off!`,url:shareLink}).catch(()=>{})||copy()} style={{background:"rgba(255,255,255,.2)",border:"1.5px solid rgba(255,255,255,.4)",color:"#fff",borderRadius:10,padding:"9px 20px",cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"inherit"}}>
            🔗 Share Link
          </button>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14,marginBottom:18}}>
        <StatBox icon="👥" label="Total Referrals"  value={user.referralCount||0}    color={T}/>
        <StatBox icon="💰" label="Total Earned"     value={`${cur}${totalEarned.toFixed(2)}`} color={GR}/>
        <StatBox icon="⭐" label="Pending Referrals" value="0"                        color={AM}/>
      </div>

      {/* Apply a code */}
      <div style={{...card({marginBottom:18})}}>
        <div style={{fontWeight:700,fontSize:15,color:NV,marginBottom:4}}>🎟 Apply a Friend's Code</div>
        <p style={{color:SL,fontSize:13,marginBottom:14}}>Enter a friend's referral code to claim your joining bonus.</p>
        <div style={{display:"flex",gap:10}}>
          <input value={applyCode} onChange={e=>setApplyCode(e.target.value.toUpperCase())} placeholder="Enter code e.g. SARA5678" maxLength={8}
            style={{flex:1,padding:"10px 14px",border:"1.5px solid #e2e8f0",borderRadius:10,fontSize:14,fontFamily:"inherit",letterSpacing:2,fontWeight:700}}/>
          <Btn primary onClick={applyReferral}>Apply</Btn>
        </div>
        {applyResult&&<div style={{marginTop:10,padding:"10px 14px",borderRadius:10,background:applyResult.success?"#dcfce7":"#fee2e2",color:applyResult.success?GR:RD,fontSize:13,fontWeight:600}}>
          {applyResult.msg}
        </div>}
      </div>

      {/* How it works */}
      <div style={{...card({marginBottom:18})}}>
        <div style={{fontWeight:700,fontSize:15,color:NV,marginBottom:14}}>How It Works</div>
        <div style={{display:"grid",gap:12}}>
          {[["1","Share your code","Send your unique referral code to friends via WhatsApp, Instagram, or any channel.","🔗"],["2","Friend signs up","Your friend creates an account and enters your code during signup.","📝"],["3","Both get rewarded","When they place their first order, you both receive "+cur+"5 credit + 500 bonus points.","🎉"]].map(([n,title,desc,ic])=>(
            <div key={n} style={{display:"flex",gap:14,alignItems:"flex-start"}}>
              <div style={{width:32,height:32,borderRadius:"50%",background:T,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:14,flexShrink:0}}>{n}</div>
              <div><div style={{fontWeight:700,fontSize:13,color:NV,marginBottom:2}}>{ic} {title}</div><div style={{fontSize:12,color:SL,lineHeight:1.5}}>{desc}</div></div>
            </div>
          ))}
        </div>
      </div>

      {/* Referral history */}
      {history.length>0&&<div style={{...card()}}>
        <div style={{fontWeight:700,fontSize:15,color:NV,marginBottom:12}}>📋 Referral History</div>
        {history.map(r=>(
          <div key={r.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"1px solid #f8fafc"}}>
            <div style={{width:34,height:34,borderRadius:"50%",background:"#f1f5f9",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>👤</div>
            <div style={{flex:1}}><div style={{fontWeight:600,fontSize:13,color:NV}}>{r.name}</div><div style={{fontSize:11,color:"#94a3b8"}}>Joined {r.joined}</div></div>
            <Pill bg="#dcfce7" color={GR}>+{cur}{r.reward}</Pill>
            <SBadge s={r.status==="credited"?"active":"pending"}/>
          </div>
        ))}
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  VENDOR ANALYTICS DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════
function VendorAnalytics({user,country,products,vendorOrders,rates}){
  const cur=CUR[country];
  const myProducts=products.filter(p=>p.vendorId===user.id||p.vendorId==="a2");
  const totalRevenue=VENDOR_WEEKLY.sales.reduce((s,v)=>s+v,0);
  const totalOrders=VENDOR_WEEKLY.orders.reduce((s,v)=>s+v,0);
  const totalCustomers=VENDOR_WEEKLY.customers.reduce((s,v)=>s+v,0);
  const avgOrderValue=(totalRevenue/totalOrders).toFixed(2);
  const commRate=(rates[user.vendorType||"ecommerce"]?.value||10)/100;
  const totalCommission=(totalRevenue*commRate).toFixed(2);
  const netRevenue=(totalRevenue*(1-commRate)).toFixed(2);
  const convRate=((totalOrders/totalCustomers)*100).toFixed(1);

  // Top products by revenue
  const topProducts=[...myProducts].sort((a,b)=>(b.revenue||0)-(a.revenue||0)).slice(0,5);
  const maxRev=Math.max(...topProducts.map(p=>p.revenue||0));

  // Customer breakdown (mock)
  const customerTypes=[{label:"Returning",pct:62,color:T},{label:"New",pct:28,color:AM},{label:"Referral",pct:10,color:PU}];

  return(
    <div>
      <h2 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:800,color:NV,marginBottom:4}}>📊 Analytics Dashboard</h2>
      <p style={{color:SL,fontSize:13,marginBottom:18}}>Last 8 weeks · {FLAG[country]} {country==="uk"?"UK":"Bangladesh"} · {user.vendorType||"ecommerce"} store</p>

      {/* KPI row */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:12,marginBottom:20}}>
        <StatBox icon="💰" label="Total Revenue"   value={`${cur}${totalRevenue.toLocaleString()}`} color={GR}  sub="8-week period"/>
        <StatBox icon="📦" label="Total Orders"    value={totalOrders}                               color={T}   sub={`${VENDOR_WEEKLY.orders.slice(-1)[0]} this week`}/>
        <StatBox icon="👥" label="Customers"       value={totalCustomers}                            color={PU}  sub={`${VENDOR_WEEKLY.customers.slice(-1)[0]} this week`}/>
        <StatBox icon="🧾" label="Avg Order Value" value={`${cur}${avgOrderValue}`}                 color={AM}  sub="Per order"/>
        <StatBox icon="🏦" label="Platform Fee"    value={`${cur}${totalCommission}`}               color={RD}  sub={`${(commRate*100).toFixed(0)}% rate`}/>
        <StatBox icon="✅" label="Net Revenue"     value={`${cur}${netRevenue}`}                    color={NV}  sub="After fees"/>
      </div>

      {/* Revenue chart */}
      <div style={{...card({marginBottom:16})}}>
        <LineChart data={VENDOR_WEEKLY.sales} labels={VENDOR_WEEKLY.labels} color={T} cur={cur} title="Weekly Revenue"/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
        {/* Orders chart */}
        <div style={{...card()}}>
          <BarChart data={VENDOR_WEEKLY.orders} labels={VENDOR_WEEKLY.labels} color={PU} title="Weekly Orders"/>
        </div>
        {/* Customer types donut-style */}
        <div style={{...card()}}>
          <div style={{fontWeight:700,fontSize:14,color:NV,marginBottom:14}}>Customer Types</div>
          {customerTypes.map(ct=>(
            <div key={ct.label} style={{marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:4}}>
                <span style={{fontWeight:600,color:NV}}>{ct.label}</span>
                <span style={{fontWeight:700,color:ct.color}}>{ct.pct}%</span>
              </div>
              <div style={{background:"#f1f5f9",borderRadius:6,height:8,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${ct.pct}%`,background:ct.color,borderRadius:6,transition:"width 1s ease"}}/>
              </div>
            </div>
          ))}
          <div style={{marginTop:10,background:"#f0fdf4",borderRadius:8,padding:"8px 10px",fontSize:12,color:GR}}>
            <strong>{convRate}%</strong> conversion rate — industry avg is 3.2%
          </div>
        </div>
      </div>

      {/* Top products */}
      <div style={{...card({marginBottom:16})}}>
        <div style={{fontWeight:700,fontSize:15,color:NV,marginBottom:14}}>🏆 Top Products by Revenue</div>
        {topProducts.map((p,i)=>(
          <div key={p.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:i<topProducts.length-1?"1px solid #f8fafc":"none"}}>
            <div style={{width:34,height:34,background:p.color||"#f1f5f9",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>{p.emoji}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:600,fontSize:13,color:NV,marginBottom:2}}>{p.name}</div>
              <div style={{background:"#f1f5f9",borderRadius:6,height:6,overflow:"hidden",marginBottom:2}}>
                <div style={{height:"100%",width:`${((p.revenue||0)/maxRev)*100}%`,background:T,borderRadius:6}}/>
              </div>
              <div style={{fontSize:11,color:SL}}>{p.sales} units sold</div>
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontWeight:800,fontSize:14,color:NV}}>{cur}{(p.revenue||0).toLocaleString()}</div>
              <div style={{fontSize:10,color:SL}}>revenue</div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent order summary table */}
      <div style={{...card()}}>
        <div style={{fontWeight:700,fontSize:15,color:NV,marginBottom:12}}>Recent Orders</div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead><tr style={{background:"#f8fafc"}}>
              {["Order ID","Customer","Items","Total","Status"].map(h=><th key={h} style={{padding:"9px 12px",textAlign:"left",color:SL,fontWeight:700,borderBottom:"1px solid #e2e8f0"}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {vendorOrders.slice(0,6).map(o=>(
                <tr key={o.id} style={{borderBottom:"1px solid #f8fafc"}}>
                  <td style={{padding:"9px 12px",fontWeight:700,color:NV,fontSize:11}}>{o.id}</td>
                  <td style={{padding:"9px 12px",color:SL}}>{o.customer}</td>
                  <td style={{padding:"9px 12px",color:SL}}>{o.items?.length||1}</td>
                  <td style={{padding:"9px 12px",fontWeight:700,color:NV}}>{CUR[o.country||"uk"]}{o.total}</td>
                  <td style={{padding:"9px 12px"}}><SBadge s={o.status}/></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  ROOT APP
// ═══════════════════════════════════════════════════════════════════════════
export default function App(){
  const [user,setUser]         =useState(null);
  const [tab,setTab]           =useState("home");
  const [modal,setModal]       =useState(null);
  const [cart,setCart]         =useState([]);
  const [toast,setToast]       =useState(null);
  const [rates,setRates]       =useState(DEFAULT_RATES);
  const [jobCats,setJobCats]   =useState(JOB_CATS);
  const [jobs,setJobs]         =useState(SEED_JOBS);
  const [vendors,setVendors]   =useState(SEED_VENDORS);
  const [drivers,setDrivers]   =useState(SEED_DRIVERS);
  const [products,setProducts] =useState(INIT_PRODUCTS);
  const [restaurants,setRests] =useState(INIT_RESTAURANTS);
  const [orders,setOrders]     =useState([]);
  const [vendorOrders,setVO]   =useState([]);
  const [notifs,setNotifs]     =useState([]);
  const [promos,setPromos]     =useState(INIT_PROMOS);
  const [appliedPromo,setAppliedPromo]=useState(null);
  const [globalSearch,setGS]   =useState("");
  const country=user?.country||"uk";
  const mapApiJob=(j)=>({
    id:j.id,
    country:j.country,
    catId:j.categoryId,
    title:j.title,
    company:j.company,
    location:j.location,
    salary:j.salary,
    minExp:j.minExp||0,
    urgent:Boolean(j.isUrgent),
    desc:j.description||"",
    applied:[],
  });

  useEffect(()=>{
    if(typeof window==="undefined") return;
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    if(!checkout) return;
    if(checkout==="success") fire("Payment completed in Stripe. Your order is being processed.");
    if(checkout==="cancelled") fire("Stripe checkout was cancelled.");
    window.history.replaceState(null,"",window.location.pathname);
  },[]);

  // Read token from URL hash (landing page redirect) or silent refresh
  useEffect(()=>{
    (async()=>{
      try{
        const hash=typeof window!=="undefined"?window.location.hash:"";
        if(hash.startsWith("#token=")){
          const t=decodeURIComponent(hash.slice(7));
          if(t){setAccessToken(t);window.history.replaceState(null,"",window.location.pathname);}
          const data=await API.me();if(data?.user){setUser(data.user);}
        } else {
          const data=await API.refresh();if(data?.user){setUser(data.user);}
        }
      }catch(_){}
    })();
  },[]);

  // Load real products
  useEffect(()=>{
    API.products({country}).then(data=>{
      if(data?.products?.length) setProducts(prev=>{
        const dbIds=new Set(data.products.map(p=>String(p.id)));
        const seedOnly=prev.filter(p=>!dbIds.has(String(p.id)));
        return [...data.products,...seedOnly];
      });
    }).catch(()=>{});
  },[country]);

  // Load jobs from backend (fully backend-driven)
  useEffect(()=>{
    API.jobs({country}).then(data=>{
      if(Array.isArray(data?.jobs)) setJobs(data.jobs.map(mapApiJob));
      else setJobs([]);
    }).catch(()=>setJobs([]));
  },[country]);

  // Load notifications (real if logged in with token, mock for demo)
  useEffect(()=>{
    if(!user) return;
    if(_accessToken){
      API.notifications().then(data=>{
        if(data?.notifications?.length) setNotifs(data.notifications.map(n=>({...n,read:n.isRead,time:new Date(n.createdAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})})));
      }).catch(()=>{});
      return;
    }
    const base={vendor:[
      {id:"n1",icon:"📦",title:"New Order Received",body:"ORD-A1B2C3 · £84.97",time:"2 min ago",read:false},
      {id:"n2",icon:"💰",title:"Payment Received",body:"£89.99 confirmed",time:"15 min ago",read:false},
      {id:"n3",icon:"⭐",title:"New 5-Star Review",body:"Sarah reviewed Classic White Tee",time:"1 hr ago",read:true},
      {id:"n4",icon:"⚠️",title:"Low Stock Alert",body:"Wool Blazer — 8 units left",time:"2 hrs ago",read:true},
    ],driver:[
      {id:"n1",icon:"🛵",title:"New Delivery Request",body:"East London → Stratford · £4.80",time:"1 min ago",read:false},
      {id:"n2",icon:"💰",title:"Earnings Credited",body:"£340 weekly earnings transferred",time:"3 hrs ago",read:false},
      {id:"n3",icon:"⭐",title:"5-Star Rating",body:"Sarah gave you 5 stars",time:"5 hrs ago",read:true},
    ],customer:[
      {id:"n1",icon:"📍",title:"Order Picked Up",body:"Arif is on the way to you",time:"3 min ago",read:false},
      {id:"n2",icon:"🎉",title:"Flash Deal: 20% off",body:"James Shop UK — Clothing sale today!",time:"10 min ago",read:false},
      {id:"n3",icon:"⭐",title:"Earn Points!",body:"You have 2,450 loyalty points to redeem",time:"1 hr ago",read:true},
      {id:"n4",icon:"🔗",title:"Referral Reward",body:"Tom joined using your code! +£5 credited",time:"3 days ago",read:true},
    ],admin:[
      {id:"n1",icon:"🏪",title:"New Vendor",body:"Dhaka Foods BD — pending approval",time:"5 min ago",read:false},
      {id:"n2",icon:"🛵",title:"New Driver",body:"James W. — pending approval",time:"20 min ago",read:false},
      {id:"n3",icon:"🎁",title:"New Promo Request",body:"Burger Lab: Student Deal — needs review",time:"1 hr ago",read:false},
    ]};
    setNotifs(base[user.role]||base.customer);
  },[user?.id]);

  // Simulate live notifs
  useEffect(()=>{
    if(!user) return;
    const iv=setInterval(()=>{
      if(Math.random()<0.25){
        const msgs={vendor:["📦 New order received!","💰 Sale completed"],driver:["🛵 Delivery request nearby","⭐ New rating received"],customer:["🎉 Flash deal near you","⭐ You earned 150 pts!"]};
        const role=user.role;
        const list=msgs[role]||msgs.customer;
        const text=list[Math.floor(Math.random()*list.length)];
        setNotifs(n=>[{id:"live_"+Date.now(),icon:text.slice(0,2),title:text.slice(3),body:"",time:"Just now",read:false},...n.slice(0,8)]);
      }
    },20000);
    return()=>clearInterval(iv);
  },[user?.id]);

  const fire=(msg,t="ok")=>{setToast({msg,t});setTimeout(()=>setToast(null),4500);};
  const login=(u)=>{
    // Called with full user object (from demo click or API response)
    if(u.accessToken){setAccessToken(u.accessToken);}
    const{accessToken:_at,...safeUser}=u;
    setUser(safeUser);setModal(null);fire(`Welcome, ${safeUser.name}! ${safeUser.avatar||"👋"}`);
  };
  const logout=async()=>{if(_accessToken)await API.logout();clearTokens();setUser(null);setTab("home");setNotifs([]);};
  const addToCart=(item,src)=>{setCart(c=>[...c,{...item,_src:src||"shop"}]);fire(`${item.name} added 🛒`);};

  const placeOrder=async(order)=>{
    const country=order.country||user?.country||"uk";
    let id="ORD-"+Math.random().toString(36).slice(2,8).toUpperCase();
    // Try real API if logged in with token
    if(_accessToken&&user){
      try{
        const data=await API.createOrder({
          items:order.items||[],
          vendorId:order.vendorId||null,
          driverId:order.driverId||null,
          subtotal:order.subtotal||order.total,
          discount:order.discount||0,
          deliveryFee:order.delivery||order.deliveryFee||0,
          platformFee:+(order.total*0.1).toFixed(2),
          total:order.total,
          payment:order.payment||"card",
          addressLine1:order.address?.line1||"",
          addressCity:order.address?.city||"",
          country,
        });
        if(data?.order?.id) id=data.order.id;
      }catch(e){console.error("Order API error:",e);}
    }
    fire(`✅ Order ${id} placed!`);
    const newO={...order,id,status:"confirmed",time:new Date().toLocaleTimeString()};
    setOrders(o=>[...o,newO]);
    if(order.vendorId){
      setVO(vo=>[{id,vendorId:order.vendorId,customer:user?.name||"Customer",address:`${order.address?.line1||""} ${order.address?.city||""}`.trim()||"Customer address",items:order.items||[],total:order.total,status:"pending",placed:new Date().toLocaleTimeString(),country,payment:order.payment||"card"},...vo]);
    }
    setCart([]);
    return id;
  };

  const calcDiscount=(subtotal)=>{
    if(!appliedPromo) return 0;
    const p=appliedPromo;
    if(subtotal<p.minOrder) return 0;
    return p.type==="percent"?+(subtotal*p.discount/100).toFixed(2):Math.min(p.discount,subtotal);
  };

  const updateDriver=(id,patch)=>setDrivers(ds=>ds.map(d=>d.id===id?{...d,...patch}:d));
  const updateVendor=(id,patch)=>setVendors(vs=>vs.map(v=>v.id===id?{...v,...patch}:v));
  const updateVendorOrder=(id,status)=>{setVO(vo=>vo.map(o=>o.id===id?{...o,status}:o));fire(`Order ${id} → ${status}`);};
  const applyToJob=async(jobId)=>{
    if(!user){setModal("login");return;}
    const target = jobs.find(j=>String(j.id)===String(jobId));
    if(!target) return;
    if((target.applied||[]).includes(user.id)){fire("You already applied to this job.");return;}
    if(_accessToken){
      try{
        await API.applyToJob(jobId,{name:user.name,email:user.email,coverLetter:"Applied from LocalHub app"});
      }catch(e){
        fire(e.message||"Could not submit application right now.");
        return;
      }
    }
    setJobs(list=>list.map(j=>String(j.id)===String(jobId)?{...j,applied:[...(j.applied||[]),user.id]}:j));
    fire(`Application sent for ${target.title}`);
  };
  const createJob=async(payload)=>{
    if(!user){setModal("login");return;}
    try{
      const data=await API.createJob(payload);
      const created=mapApiJob(data.job);
      setJobs(prev=>[created,...prev]);
      setModal(null);
      fire("Job posted successfully.");
    }catch(e){
      fire(e.message||"Could not post job right now.");
    }
  };
  const markNotifRead=(id)=>setNotifs(n=>n.map(x=>x.id===id?{...x,read:true}:x));
  const markAllRead=()=>{setNotifs(n=>n.map(x=>({...x,read:true})));if(_accessToken)API.markAllRead().catch(()=>{});};

  const approvePromo=(id)=>{setPromos(ps=>ps.map(p=>p.id===id?{...p,status:"active"}:p));fire("✅ Promo approved and live!");};
  const rejectPromo=(id)=>{setPromos(ps=>ps.map(p=>p.id===id?{...p,status:"rejected"}:p));fire("Promo rejected.");};

  const isAdmin=user?.role==="admin";
  const isVendor=user?.role==="vendor";
  const isDriver=user?.role==="driver";

  const TABS=[
    {id:"home",    icon:"🏠",label:"Home"},
    ...((user?.role==="customer"||!user)?[{id:"dashboard",icon:"📊",label:"Dashboard"}]:[]),
    {id:"ecommerce",icon:"🛍️",label:"Shop"},
    {id:"grocery", icon:"🛒",label:"Grocery"},
    {id:"food",    icon:"🍔",label:"Food"},
    {id:"jobs",    icon:"💼",label:"Jobs"},
    {id:"delivery",icon:"🛵",label:"Delivery"},
    {id:"loyalty", icon:"⭐",label:"Rewards"},
    {id:"referral",icon:"🔗",label:"Refer"},
    ...(isAdmin ?[{id:"admin",  icon:"⚙️",label:"Admin"}]:[]),
    ...(isVendor?[{id:"vendor", icon:"📊",label:"My Store"}]:[]),
    ...(isDriver?[{id:"driver", icon:"🛵",label:"Dashboard"}]:[]),
  ];

  const cartGroups=Object.keys(cart.reduce((g,i)=>{const v=i.vendorId||"x";g[v]=1;return g;},{}));
  const cartTotal=cart.reduce((s,i)=>s+(+i.price||0),0);
  const discount=calcDiscount(cartTotal);
  const unreadNotifs=notifs.filter(n=>!n.read).length;

  return(
    <div style={{fontFamily:"'DM Sans',system-ui,sans-serif",minHeight:"100vh",background:"linear-gradient(180deg,#eef4fb 0%,#f7fafc 52%,#ecf2f9 100%)"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,600;9..40,700;9..40,800&family=Syne:wght@700;800&display=swap" rel="stylesheet"/>
      <style>{`*{box-sizing:border-box}button{transition:opacity .15s}button:hover:not(:disabled){opacity:.85}input,select,textarea{outline:none}
        @keyframes slideDown{from{transform:translateY(-10px);opacity:0}to{transform:none;opacity:1}}
        @keyframes fadeIn{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
        ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}
      `}</style>

      {toast&&<div style={{position:"fixed",top:68,right:20,zIndex:9999,background:"#059669",color:"#fff",padding:"12px 20px",borderRadius:12,boxShadow:"0 8px 30px rgba(0,0,0,.2)",fontSize:14,fontWeight:600,animation:"slideDown .3s ease",maxWidth:380}}>{toast.msg}</div>}

      {/* HEADER */}
      <header style={{background:"#0a1630",position:"sticky",top:0,zIndex:200,boxShadow:"0 8px 30px rgba(3,10,28,.45)"}}>
        <div style={{maxWidth:1320,margin:"0 auto",padding:"0 16px",display:"flex",alignItems:"center",height:64,gap:10}}>
          <div style={{fontFamily:"Syne,sans-serif",fontSize:20,fontWeight:800,letterSpacing:"-1px",flexShrink:0}}>
            <span style={{color:"#14b8a6"}}>LOCAL</span><span style={{color:AM}}>HUB</span>
          </div>
          <nav style={{display:"flex",gap:6,flex:1,justifyContent:"center",flexWrap:"wrap"}}>
            {TABS.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{background:tab===t.id?"#123569":"transparent",border:`1px solid ${tab===t.id?"#1ca6ad":"#20365f"}`,color:tab===t.id?"#e6fffd":"#a8b6cf",padding:"6px 10px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:700,display:"flex",alignItems:"center",gap:4}}>
                <span style={{fontSize:13}}>{t.icon}</span><span>{t.label}</span>
              </button>
            ))}
          </nav>
          <div style={{flexShrink:0,display:"flex",alignItems:"center",gap:6}}>
            {user&&<>
              {user.role==="customer"&&<LoyaltyBadge points={user.points||0} country={country} onClick={()=>setTab("loyalty")}/>}
              {cart.length>0&&(
                <button onClick={()=>setModal("cart")} style={{background:"#1e293b",border:"none",color:"#fff",borderRadius:8,padding:"5px 10px",cursor:"pointer",fontSize:12,fontWeight:600,display:"flex",alignItems:"center",gap:5,position:"relative"}}>
                  🛒 {cart.length}
                  {discount>0&&<Pill bg={AM} color={NV} style={{fontSize:9,padding:"1px 5px"}}>-{CUR[country]}{discount}</Pill>}
                  {cartGroups.length>1&&<Pill bg={PU} color="#fff" style={{fontSize:9,padding:"1px 5px"}}>{cartGroups.length}v</Pill>}
                </button>
              )}
              <button onClick={()=>setModal("chat")} style={{background:"none",border:"1px solid #334155",color:"#94a3b8",borderRadius:8,padding:"5px 9px",cursor:"pointer",fontSize:14}}>💬</button>
              <NotifBell notifs={notifs} onMarkRead={markNotifRead} onMarkAll={markAllRead} onClear={()=>setNotifs([])}/>
              <div style={{background:"#1e293b",borderRadius:20,padding:"4px 10px",display:"flex",alignItems:"center",gap:5}}>
                <span style={{fontSize:14}}>{user.avatar}</span>
                <span style={{fontSize:11,color:"#e2e8f0",fontWeight:600}}>{user.name.split(" ")[0]}</span>
                <span>{FLAG[user.country]}</span>
              </div>
              <button onClick={logout} style={{background:"none",border:"1px solid #334155",color:"#94a3b8",borderRadius:8,padding:"4px 9px",cursor:"pointer",fontSize:11}}>Out</button>
            </>}
            {!user&&<>
              <button onClick={()=>setModal("login")} style={{background:"transparent",border:"1px solid #475569",color:"#94a3b8",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:12,fontWeight:600}}>Log In</button>
              <button onClick={()=>setModal("signup")} style={{background:AM,border:"none",color:NV,borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:12,fontWeight:700}}>Sign Up</button>
            </>}
          </div>
        </div>
        {/* Search */}
        <div style={{borderTop:"1px solid #172b4d",padding:"8px 16px",display:"flex",gap:10,alignItems:"center"}}>
          <div style={{position:"relative",flex:1,maxWidth:440}}>
            <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:14,color:SL}}>🔍</span>
              <input value={globalSearch} onChange={e=>setGS(e.target.value)} placeholder="Search products, restaurants, jobs..."
                style={{width:"100%",padding:"9px 12px 9px 32px",border:"1.5px solid #223b66",borderRadius:11,fontSize:12,fontFamily:"inherit",background:"#0d1c37",color:"#d6e6ff"}}/>
            {globalSearch&&<button onClick={()=>setGS("")} style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",border:"none",background:"none",cursor:"pointer",fontSize:14,color:"#475569"}}>✕</button>}
          </div>
          <div style={{fontSize:11,color:"#475569",flexShrink:0}}>
            {FLAG[country]} {country==="uk"?"UK":"Bangladesh"}
            {appliedPromo&&<span style={{marginLeft:8,color:AM,fontWeight:600}}>🎉 Deal active: {appliedPromo.type==="percent"?`${appliedPromo.discount}% OFF`:`${CUR[country]}${appliedPromo.discount} OFF`}</span>}
          </div>
        </div>
      </header>

      {/* PAGES */}
      <div style={{maxWidth:1320,margin:"0 auto",padding:"22px 16px 90px"}}>
        {/* Promo banners on all content tabs */}
        {["home","ecommerce","grocery","food"].includes(tab)&&<PromoBanners promos={promos} country={country} user={user} onApply={setAppliedPromo} appliedPromo={appliedPromo}/>}

        {tab==="home"     &&<HomePage setTab={setTab} user={user} setModal={setModal} country={country} rates={rates} orders={orders} drivers={drivers} promos={promos}/>}
        {tab==="dashboard"&&user&&user.role==="customer"&&<CustomerDashboard user={user} country={country} orders={orders} setTab={setTab}/>}
        {tab==="dashboard"&&(!user||user.role!=="customer")&&<SignInPrompt msg="Sign in as a customer to view your dashboard and order history." setModal={setModal}/>}
        {tab==="ecommerce"&&<EcommercePage products={products} country={country} addToCart={addToCart} rates={rates} cart={cart}/>}
        {tab==="grocery"  &&<GroceryPage   items={INIT_GROCERY.filter(i=>i.country===country)} country={country} addToCart={addToCart} cart={cart}/>}
        {tab==="food"     &&<FoodPage       restaurants={restaurants.filter(r=>r.country===country)} country={country} addToCart={addToCart}/>}
        {tab==="jobs"     &&<JobsPage       jobs={jobs} jobCats={jobCats} user={user} country={country} setModal={setModal} globalSearch={globalSearch} onApply={applyToJob}/>}
        {tab==="delivery" &&<DeliveryPage   drivers={drivers.filter(d=>d.country===country&&d.status==="active")} country={country} rates={rates} placeOrder={placeOrder} user={user} setModal={setModal}/>}
        {tab==="loyalty"  &&user&&<LoyaltyPage user={user} setUser={setUser} country={country}/>}
        {tab==="loyalty"  &&!user&&<SignInPrompt msg="Sign in to view your loyalty points and rewards." setModal={setModal}/>}
        {tab==="referral" &&user&&<ReferralPage user={user} country={country} setUser={setUser} fire={fire}/>}
        {tab==="referral" &&!user&&<SignInPrompt msg="Sign in to get your referral code and earn rewards." setModal={setModal}/>}
        {tab==="admin"  &&isAdmin &&<AdminPanel vendors={vendors} updateVendor={updateVendor} drivers={drivers} updateDriver={updateDriver} rates={rates} setRates={setRates} promos={promos} approvePromo={approvePromo} rejectPromo={rejectPromo} orders={[...vendorOrders,...orders]}/>}
        {tab==="vendor" &&isVendor&&<VendorDash user={user} country={country} rates={rates} products={products.filter(p=>p.vendorId===user.id||p.vendorId==="a2")} setProducts={setProducts} vendorOrders={vendorOrders.filter(o=>o.vendorId===user.id||o.vendorId==="a2")} updateVendorOrder={updateVendorOrder} promos={promos} setPromos={setPromos} fire={fire}/>}
        {tab==="driver" &&isDriver &&<DriverDash user={user} drivers={drivers} updateDriver={updateDriver} country={country} rates={rates}/>}
      </div>

      {/* MODALS */}
      {modal==="login"  &&<LoginModal  accounts={ALL_ACCOUNTS} onLogin={login} onClose={()=>setModal(null)} onSwitch={()=>setModal("signup")}/>}
      {modal==="signup" &&<SignupModal jobCats={jobCats} onSignup={login} onClose={()=>setModal(null)} onSwitch={()=>setModal("login")}/>}
      {modal==="postjob"&&<PostJobModal jobCats={jobCats} country={country} onCreate={createJob} onClose={()=>setModal(null)}/>}
      {modal==="chat"   &&user&&<ChatPanel user={user} onClose={()=>setModal(null)}/>}
      {modal==="cart"   &&<CartModal cart={cart} setCart={setCart} products={products} country={country} drivers={drivers.filter(d=>d.country===country&&d.isOnline&&d.status==="active")} rates={rates} placeOrder={placeOrder} user={user} setModal={setModal} onClose={()=>setModal(null)} appliedPromo={appliedPromo} calcDiscount={calcDiscount}/>}
    </div>
  );
}

// ─── SIGN IN PROMPT ────────────────────────────────────────────────────────
function SignInPrompt({msg,setModal}){
  return(
    <div style={{...card({textAlign:"center",padding:60})}}>
      <div style={{fontSize:52,marginBottom:14}}>🔐</div>
      <div style={{fontWeight:700,fontSize:18,color:NV,marginBottom:8}}>Sign In Required</div>
      <div style={{color:SL,fontSize:14,marginBottom:20}}>{msg}</div>
      <Btn primary onClick={()=>setModal("login")}>Log In</Btn>
    </div>
  );
}

function CustomerDashboard({user,country,orders,setTab}){
  const recentOrders = [...orders].reverse().slice(0,8);
  const delivered = recentOrders.filter(o=>o.status==="delivered"||o.status==="confirmed").length;
  const totalSpent = recentOrders.reduce((s,o)=>s+(+o.total||0),0);
  const points = user?.points||0;
  return(
    <div>
      <div style={{...shellCard({background:"linear-gradient(135deg,#0f2d57 0%,#164a7a 55%,#0f3b66 100%)",color:"#e6f1ff",marginBottom:16,borderColor:"#1e4e86"})}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:12,opacity:.8,marginBottom:4}}>Customer Dashboard</div>
            <h2 style={{fontFamily:"Syne,sans-serif",fontSize:28,fontWeight:800,lineHeight:1.1}}>Welcome back, {user?.name?.split(" ")[0]||"Customer"}</h2>
            <div style={{marginTop:8,fontSize:13,opacity:.9}}>Track orders, manage rewards, and continue shopping locally.</div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <Btn onClick={()=>setTab("ecommerce")} style={{background:"#ffffff",borderColor:"#ffffff",color:"#123869"}}>Continue Shopping</Btn>
            <Btn onClick={()=>setTab("loyalty")} style={{background:"transparent",borderColor:"#8ec5ff",color:"#dbeafe"}}>View Rewards</Btn>
          </div>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:12,marginBottom:16}}>
        <div style={shellCard()}><div style={{fontSize:12,color:SL}}>Recent Orders</div><div style={{fontSize:30,fontWeight:800,color:NV}}>{recentOrders.length}</div></div>
        <div style={shellCard()}><div style={{fontSize:12,color:SL}}>Delivered</div><div style={{fontSize:30,fontWeight:800,color:"#166534"}}>{delivered}</div></div>
        <div style={shellCard()}><div style={{fontSize:12,color:SL}}>Total Spent</div><div style={{fontSize:30,fontWeight:800,color:NV}}>{CUR[country]}{totalSpent.toFixed(2)}</div></div>
        <div style={shellCard()}><div style={{fontSize:12,color:SL}}>Loyalty Points</div><div style={{fontSize:30,fontWeight:800,color:"#a16207"}}>{points.toLocaleString()}</div></div>
      </div>

      <div style={shellCard()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{fontFamily:"Syne,sans-serif",fontSize:18,fontWeight:800,color:NV}}>Order History</div>
          <div style={{fontSize:12,color:SL}}>Latest {recentOrders.length} orders</div>
        </div>
        {recentOrders.length===0&&<div style={{fontSize:13,color:SL,padding:"8px 0"}}>No orders yet. Place your first order from Shop, Grocery, Food, or Delivery.</div>}
        {recentOrders.length>0&&(
          <div style={{display:"grid",gap:8}}>
            {recentOrders.map((o,idx)=>(
              <div key={o.id||idx} style={{display:"grid",gridTemplateColumns:"1.2fr .8fr .8fr .8fr",gap:10,alignItems:"center",padding:"10px 12px",border:"1px solid #e2e8f0",borderRadius:10,background:"#f8fbff"}}>
                <div style={{fontSize:12,color:NV,fontWeight:700}}>{o.id||"Pending ID"}</div>
                <div style={{fontSize:12,color:SL}}>{o.time||o.placed||"Just now"}</div>
                <div style={{fontSize:12,color:NV,fontWeight:700}}>{CUR[o.country||country]}{(+o.total||0).toFixed(2)}</div>
                <div style={{justifySelf:"start"}}><SBadge s={o.status||"pending"}/></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  HOME PAGE
// ═══════════════════════════════════════════════════════════════════════════
function HomePage({setTab,user,setModal,country,rates,orders,drivers,promos}){
  const features=[
    {id:"ecommerce",icon:"🛍️",label:"E-Commerce",  desc:"Shop local with AI try-on",         color:"#7c3aed"},
    {id:"grocery",  icon:"🛒",label:"Grocery",     desc:"Fresh from local shops",             color:GR},
    {id:"food",     icon:"🍔",label:"Food Delivery",desc:"Hot food within 5 miles",           color:RD},
    {id:"jobs",     icon:"💼",label:"Jobs",         desc:"Local jobs matched to your skills", color:"#2563eb"},
    {id:"delivery", icon:"🛵",label:"Local Delivery",desc:"Send anything · e-bike only",      color:T},
    {id:"loyalty",  icon:"⭐",label:"Rewards",      desc:"Earn points on every order",        color:AM},
    {id:"referral", icon:"🔗",label:"Refer & Earn", desc:"Share your code · earn credit",     color:OR},
  ];
  const activePromos=promos.filter(p=>p.country===country&&p.status==="active");
  return(
    <div>
      <div style={{background:`linear-gradient(135deg,${NV} 0%,#1e3a5f 100%)`,borderRadius:20,padding:"36px",marginBottom:16,color:"#fff",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",right:30,top:"50%",transform:"translateY(-50%)",fontSize:90,opacity:.05}}>🌍</div>
        <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
          {["🇬🇧 UK","🇧🇩 Bangladesh","⭐ Loyalty Rewards","🔗 Refer & Earn","💬 Live Chat","🎉 Flash Deals"].map(t=>(
            <Pill key={t} bg="rgba(255,255,255,.1)" color="#94a3b8" style={{fontSize:10}}>{t}</Pill>
          ))}
        </div>
        <h1 style={{fontFamily:"Syne,sans-serif",fontSize:32,fontWeight:800,letterSpacing:"-1.5px",lineHeight:1.15,marginBottom:10}}>
          Your Local Community,<br/><span style={{color:"#14b8a6"}}>All in One Place</span>
        </h1>
        <p style={{color:"#94a3b8",fontSize:14,marginBottom:20}}>
          Viewing <strong style={{color:AM}}>{FLAG[country]} {country==="uk"?"United Kingdom":"Bangladesh"}</strong>
          {activePromos.length>0&&<> · <span style={{color:"#fbbf24"}}>🔥 {activePromos.length} active deal{activePromos.length>1?"s":""} near you</span></>}
        </p>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          {!user&&<><Btn primary onClick={()=>setModal("signup")} style={{fontSize:13,padding:"10px 20px"}}>Get Started Free</Btn>
          <Btn onClick={()=>setModal("login")} style={{fontSize:13,padding:"10px 20px",background:"transparent",color:"#fff",borderColor:"#475569"}}>Log In</Btn></>}
          {user&&orders.length>0&&<Btn primary style={{fontSize:13,padding:"10px 20px"}}>📍 {orders.length} Order{orders.length>1?"s":""}</Btn>}
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:12,marginBottom:16}}>
        {features.map(f=>(
          <div key={f.id} onClick={()=>setTab(f.id)} style={{...card(),cursor:"pointer",borderTop:`3px solid ${f.color}`,transition:"transform .18s,box-shadow .18s"}}
            onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow="0 10px 28px rgba(0,0,0,.1)"}}
            onMouseLeave={e=>{e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow="none"}}>
            <div style={{fontSize:28,marginBottom:8}}>{f.icon}</div>
            <div style={{fontWeight:700,fontSize:13,color:NV,marginBottom:3}}>{f.label}</div>
            <div style={{fontSize:11,color:SL,lineHeight:1.5}}>{f.desc}</div>
          </div>
        ))}
      </div>
      <LiveMap drivers={drivers} country={country}/>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  SHOP, GROCERY, FOOD, JOBS, DELIVERY (compact)
// ═══════════════════════════════════════════════════════════════════════════
function EcommercePage({products,country,addToCart,rates,cart}){
  const [cat,setCat]=useState("All");
  const local=products.filter(p=>p.country===country);
  const cats=["All",...new Set(local.map(p=>p.cat))];
  const filtered=local.filter(p=>cat==="All"||p.cat===cat);
  return(
    <div>
      <div style={{marginBottom:14}}><h2 style={{fontFamily:"Syne,sans-serif",fontSize:24,fontWeight:800,color:NV}}>🛍️ Local Shop — {FLAG[country]}</h2>
        <p style={{color:SL,fontSize:13}}>Local vendors · {rates.ecommerce.value}% fee · Earn {POINTS_PER_UNIT[country]} pts per {CUR[country]}1</p></div>
      <div style={{display:"flex",gap:7,marginBottom:14,flexWrap:"wrap"}}>
        {cats.map(c=><button key={c} onClick={()=>setCat(c)} style={{border:`1.5px solid ${cat===c?T:"#e2e8f0"}`,background:cat===c?T:"#fff",color:cat===c?"#fff":"#475569",borderRadius:20,padding:"5px 13px",fontSize:12,fontWeight:600,cursor:"pointer"}}>{c}</button>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(205px,1fr))",gap:14}}>
        {filtered.map(item=>{
          const inCart=cart.filter(c=>c.id===item.id).length;
          return(
            <div key={item.id} style={{...card(),overflow:"hidden"}}>
              <div style={{height:130,background:item.color||"#f1f5f9",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:56,marginBottom:12,position:"relative"}}>
                {item.emoji}
                {inCart>0&&<div style={{position:"absolute",top:8,right:8}}><Pill bg={AM} color={NV} style={{fontSize:9}}>×{inCart}</Pill></div>}
              </div>
              <div style={{fontWeight:700,fontSize:13,color:NV,marginBottom:3}}>{item.name}</div>
              <div style={{fontSize:11,color:SL,marginBottom:8}}>{item.cat}</div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div><span style={{fontSize:15,fontWeight:800,color:NV}}>{fmt(item.price,country)}</span>
                  <div style={{fontSize:10,color:AM}}>+{Math.floor(item.price*POINTS_PER_UNIT[country])} pts</div></div>
                <Btn small primary onClick={()=>addToCart(item,"ecommerce")}>+ Add</Btn>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GroceryPage({items,country,addToCart,cart}){
  const cats=["All",...new Set(items.map(i=>i.cat))];
  const [cat,setCat]=useState("All");
  const filtered=items.filter(i=>cat==="All"||i.cat===cat);
  return(
    <div>
      <div style={{marginBottom:14}}><h2 style={{fontFamily:"Syne,sans-serif",fontSize:24,fontWeight:800,color:NV}}>🛒 Local Grocery — {FLAG[country]}</h2></div>
      <div style={{display:"flex",gap:7,marginBottom:14,flexWrap:"wrap"}}>{cats.map(c=><button key={c} onClick={()=>setCat(c)} style={{border:`1.5px solid ${cat===c?T:"#e2e8f0"}`,background:cat===c?T:"#fff",color:cat===c?"#fff":"#475569",borderRadius:20,padding:"5px 13px",fontSize:12,fontWeight:600,cursor:"pointer"}}>{c}</button>)}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(165px,1fr))",gap:12}}>
        {filtered.map(item=>(
          <div key={item.id} style={{...card({padding:14})}}>
            <div style={{height:70,background:"#f0fdf4",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:38,marginBottom:10}}>{item.emoji}</div>
            <div style={{fontWeight:600,fontSize:13,color:NV,marginBottom:2}}>{item.name}</div>
            <div style={{fontSize:11,color:"#94a3b8",marginBottom:8}}>{item.cat}</div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span style={{fontSize:14,fontWeight:800,color:NV}}>{fmt(item.price,country)}</span>
              <Btn small primary onClick={()=>addToCart(item,"grocery")}>+ Add</Btn>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FoodPage({restaurants,country,addToCart}){
  const [open,setOpen]=useState(null);
  return(
    <div>
      <div style={{marginBottom:14}}><h2 style={{fontFamily:"Syne,sans-serif",fontSize:24,fontWeight:800,color:NV}}>🍔 Food Delivery — {FLAG[country]}</h2></div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(285px,1fr))",gap:14}}>
        {restaurants.map(r=>(
          <div key={r.id} style={{...card(),cursor:"pointer",border:open===r.id?`2px solid ${T}`:"1px solid #e2e8f0"}} onClick={()=>setOpen(open===r.id?null:r.id)}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
              <div style={{width:46,height:46,background:"#fef3c7",borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24}}>{r.emoji}</div>
              <div style={{flex:1}}><div style={{fontWeight:700,fontSize:14,color:NV}}>{r.name}</div><div style={{fontSize:12,color:SL}}>{r.cuisine} · {r.time}</div></div>
              <StarDisp r={r.rating}/>
            </div>
            {open===r.id&&r.menu.map(m=>(
              <div key={m.n} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid #f8fafc"}}>
                <span style={{fontSize:13,color:NV}}>{m.n}</span>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontWeight:700,fontSize:13}}>{fmt(m.p,country)}</span>
                  <Btn small primary onClick={e=>{e.stopPropagation();addToCart({id:r.id*100+Math.random(),name:m.n,price:m.p,emoji:r.emoji,vendorId:r.vendorId,from:r.name},"food");}}>+</Btn>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function JobsPage({jobs,jobCats,user,country,setModal,globalSearch,onApply}){
  const [selCat,setSelCat]=useState(null);
  const filtered=jobs.filter(j=>j.country===country).filter(j=>!selCat||j.catId===selCat).filter(j=>!globalSearch||j.title.toLowerCase().includes(globalSearch.toLowerCase()));
  return(
    <div>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:10}}>
        <div><h2 style={{fontFamily:"Syne,sans-serif",fontSize:24,fontWeight:800,color:NV}}>💼 Local Jobs — {FLAG[country]}</h2></div>
        <Btn primary onClick={()=>setModal("postjob")}>📋 Post a Job</Btn>
      </div>
      <div style={{display:"flex",gap:7,marginBottom:14,flexWrap:"wrap"}}>
        <button onClick={()=>setSelCat(null)} style={{border:`1.5px solid ${!selCat?T:"#e2e8f0"}`,background:!selCat?T:"#fff",color:!selCat?"#fff":"#475569",borderRadius:20,padding:"5px 13px",fontSize:12,fontWeight:600,cursor:"pointer"}}>All</button>
        {jobCats.map(cat=><button key={cat.id} onClick={()=>setSelCat(selCat===cat.id?null:cat.id)} style={{border:`1.5px solid ${selCat===cat.id?T:"#e2e8f0"}`,background:selCat===cat.id?T:"#fff",color:selCat===cat.id?"#fff":"#475569",borderRadius:20,padding:"5px 12px",fontSize:12,fontWeight:600,cursor:"pointer"}}>{cat.icon} {cat.name}</button>)}
      </div>
      <div style={{display:"grid",gap:12}}>
        {filtered.map(job=>{
          const cat=jobCats.find(c=>c.id===job.catId);
          const hasApplied = Boolean(user && (job.applied||[]).includes(user.id));
          return(
            <div key={job.id} style={{...card(),display:"flex",gap:14,alignItems:"flex-start"}}>
              <div style={{width:40,height:40,background:TL,borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>{cat?.icon||"💼"}</div>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3,flexWrap:"wrap"}}>
                  <span style={{fontWeight:700,fontSize:14,color:NV}}>{job.title}</span>
                  {job.urgent&&<Pill bg="#fee2e2" color={RD}>Urgent</Pill>}
                </div>
                <div style={{fontSize:12,color:SL,marginBottom:5}}>{job.company} · {job.location}</div>
                <div style={{fontSize:13,color:"#475569",lineHeight:1.5,marginBottom:8}}>{job.desc}</div>
                <Pill bg="#f0fdf4" color={GR}>💰 {job.salary}</Pill>
              </div>
              <Btn small primary={hasApplied?false:true} onClick={()=>onApply(job.id)} style={hasApplied?{borderColor:"#16a34a",color:"#16a34a"}:{}}>
                {hasApplied?"Applied":"Apply"}
              </Btn>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DeliveryPage({drivers,country,rates,placeOrder,user,setModal}){
  const [pickup,setPickup]=useState(""),[ dropoff,setDropoff]=useState("");
  const [parcel,setParcel]=useState("small");
  const [quotes,setQuotes]=useState(null);
  const [dist,setDist]=useState(null);
  const [selDriver,setSel]=useState(null);
  const [booked,setBooked]=useState(null);
  const [loading,setLoading]=useState(false);
  const [err,setErr]=useState("");
  const cur=CUR[country],unit=country==="uk"?"miles":"km";
  const findDrivers=async()=>{
    setErr("");if(!pickup.trim()||!dropoff.trim()){setErr("Please enter both addresses.");return;}setLoading(true);
    try{const[la1,lo1]=getCoords(pickup,country),[la2,lo2]=getCoords(dropoff,country);const d=await getRoadDist(la1,lo1,la2,lo2,unit);if(d>10){setErr(`Distance ${d} ${unit} — exceeds 10 ${unit} limit.`);return;}
    const pm={small:1,medium:1.3,large:1.6}[parcel];const q=drivers.filter(dr=>dr.pricing.maxDist>=d&&dr.isOnline).map(dr=>({...dr,quote:+(calcDriverQuote(dr,d)*pm).toFixed(2),eta:calcETA(d,country),distance:d})).sort((a,b)=>a.quote-b.quote).slice(0,5);setQuotes(q);setDist(d);setSel(null);}finally{setLoading(false);}
  };
  return(
    <div>
      <div style={{marginBottom:14}}><h2 style={{fontFamily:"Syne,sans-serif",fontSize:24,fontWeight:800,color:NV}}>🛵 Local Delivery — {FLAG[country]}</h2>
        <p style={{color:SL,fontSize:13}}>E-bikes & scooters only · Max 10 {unit} · OSRM road distance</p></div>
      {!booked&&<div style={{...card({marginBottom:14})}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          <div><div style={{fontSize:12,fontWeight:700,color:SL,marginBottom:5}}>📍 Pickup</div><input value={pickup} onChange={e=>setPickup(e.target.value)} placeholder="Enter pickup address" style={{width:"100%",padding:"10px 14px",border:"1.5px solid #e2e8f0",borderRadius:10,fontSize:13,fontFamily:"inherit"}}/></div>
          <div><div style={{fontSize:12,fontWeight:700,color:SL,marginBottom:5}}>🏁 Drop-off</div><input value={dropoff} onChange={e=>setDropoff(e.target.value)} placeholder="Enter drop-off address" style={{width:"100%",padding:"10px 14px",border:"1.5px solid #e2e8f0",borderRadius:10,fontSize:13,fontFamily:"inherit"}}/></div>
        </div>
        <div style={{display:"flex",gap:8,marginBottom:12}}>{[["small","📦","Small"],["medium","🗃️","Medium"],["large","📫","Large"]].map(([v,ic,l])=><div key={v} onClick={()=>setParcel(v)} style={{flex:1,border:`2px solid ${parcel===v?T:"#e2e8f0"}`,borderRadius:10,padding:"8px",cursor:"pointer",background:parcel===v?TL:"#fff",textAlign:"center"}}><div style={{fontSize:20}}>{ic}</div><div style={{fontSize:12,fontWeight:600,color:NV}}>{l}</div></div>)}</div>
        {err&&<div style={{color:RD,fontSize:13,marginBottom:10,background:"#fee2e2",padding:"8px 12px",borderRadius:8}}>{err}</div>}
        <Btn primary full onClick={findDrivers} disabled={loading}>{loading?"📡 Calculating...":"🔍 Find Drivers"}</Btn>
      </div>}
      {quotes&&!booked&&<div style={{...card()}}>
        <div style={{fontWeight:700,fontSize:14,color:NV,marginBottom:4}}>{quotes.length} Drivers · Road distance: {dist} {unit}</div>
        <div style={{display:"grid",gap:8,marginBottom:12}}>
          {quotes.map((d,i)=>(
            <div key={d.id} onClick={()=>setSel(d.id)} style={{border:`2px solid ${selDriver===d.id?T:"#e2e8f0"}`,borderRadius:10,padding:"11px 13px",cursor:"pointer",background:selDriver===d.id?TL:"#fff",display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:34,height:34,background:"#f1f5f9",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🛵</div>
              <div style={{flex:1}}><div style={{fontWeight:700,fontSize:13,color:NV}}>{d.name} {i===0&&"💰"}</div><div style={{fontSize:11,color:SL}}>{d.vehicle} · ~{d.eta} min</div></div>
              <div style={{textAlign:"right"}}><div style={{fontSize:18,fontWeight:800,color:T}}>{cur}{d.quote}</div>{selDriver===d.id&&<div style={{color:T,fontSize:16}}>✓</div>}</div>
            </div>
          ))}
        </div>
        {selDriver&&<Btn primary full onClick={()=>{if(!user){setModal("login");return;}const dr=quotes.find(q=>q.id===selDriver);setBooked({id:"ORD-"+Math.random().toString(36).slice(2,8).toUpperCase(),driver:dr,dist,total:dr.quote,country});placeOrder({items:[{name:`Delivery: ${pickup}→${dropoff}`,price:dr.quote,emoji:"📦",vendorId:"delivery"}],subtotal:dr.quote,total:dr.quote,driver:dr.name,address:{line1:dropoff},country});}}>
          Confirm — {cur}{quotes.find(q=>q.id===selDriver)?.quote} 🎉
        </Btn>}
      </div>}
      {booked&&<div style={{...card({textAlign:"center",background:"#f0fdf4",borderColor:"#86efac",padding:"36px 28px"})}}>
        <div style={{fontSize:52,marginBottom:12}}>🎉</div>
        <div style={{fontFamily:"Syne,sans-serif",fontSize:20,fontWeight:800,color:"#15803d",marginBottom:6}}>Booking Confirmed!</div>
        <div style={{color:"#166534",fontSize:13,marginBottom:16}}>{booked.driver.name} · ~{booked.driver.eta} min · {cur}{booked.total}</div>
        <div style={{marginTop:16}}><Btn onClick={()=>{setBooked(null);setQuotes(null);setPickup("");setDropoff("");setSel(null);}}>Book Another</Btn></div>
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  CART MODAL (with promo discount + multi-vendor)
// ═══════════════════════════════════════════════════════════════════════════
function CartModal({cart,setCart,products,country,drivers,rates,placeOrder,user,setModal,onClose,appliedPromo,calcDiscount}){
  const [step,setStep]=useState(1);
  const [addr,setAddr]=useState({line1:"",city:"",postcode:""});
  const [quotes,setQuotes]=useState(null);
  const [selDriver,setSel]=useState(null);
  const [payment,setPay]=useState(country==="uk"?"card":"bkash");
  const [loading,setLoading]=useState(false);
  const [dist,setDist]=useState(null);
  const [err,setErr]=useState("");
  const [orderId,setOId]=useState(null);
  const cur=CUR[country];
  const subtotal=cart.reduce((s,i)=>s+(+i.price||0),0);
  const discount=calcDiscount(subtotal);
  const discountedSubtotal=subtotal-discount;
  const rateKey="ecommerce";
  const commission=+(discountedSubtotal*(rates[rateKey]?.value||10)/100).toFixed(2);
  const unit=country==="uk"?"miles":"km";

  // Group by vendor
  const grouped={};
  cart.forEach(item=>{const v=item.vendorId||"x";if(!grouped[v])grouped[v]=[];grouped[v].push(item);});
  const vendorCount=Object.keys(grouped).length;

  const findDrivers=async()=>{
    setErr("");setLoading(true);
    try{const[la1,lo1]=getCoords("East London",country),[la2,lo2]=getCoords(`${addr.line1} ${addr.city}`,country);const d=await getRoadDist(la1,lo1,la2,lo2,unit);if(d>10){setErr(`Too far: ${d} ${unit}.`);return;}const q=drivers.filter(dr=>dr.pricing.maxDist>=d).map(dr=>({...dr,quote:+(calcDriverQuote(dr,d)).toFixed(2),eta:calcETA(d,country),distance:d})).sort((a,b)=>a.quote-b.quote).slice(0,5);setDist(d);setQuotes(q);setStep(3);}finally{setLoading(false);}
  };
  const confirmOrder=async()=>{
    const dr=quotes.find(q=>q.id===selDriver);
    const total=+(discountedSubtotal+(dr?.quote||0)).toFixed(2);
    const id=await placeOrder({items:cart,subtotal:discountedSubtotal,commission,delivery:dr.quote,total,driver:dr.name,address:addr,payment,country,vendorId:cart[0]?.vendorId||"a2",appliedPromo:appliedPromo?.id});
    if(payment==="card"&&_accessToken){
      try{
        const data=await API.createIntent({orderId:id,amount:total,currency:country==="uk"?"gbp":"bdt",checkout:true});
        if(data?.checkoutUrl){
          window.location.assign(data.checkoutUrl);
          return;
        }
      }catch(_){}
    }
    setOId(id);setStep(5);
  };
  const STEPS=["Review","Address","Driver","Payment","Done"];

  if(cart.length===0)return(<div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.8)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={onClose}>
    <div style={{background:"#fff",borderRadius:20,padding:"40px",textAlign:"center",animation:"fadeIn .2s ease"}}><div style={{fontSize:52,marginBottom:12}}>🛒</div><div style={{fontWeight:700,fontSize:18,color:NV,marginBottom:10}}>Cart is empty</div><Btn primary onClick={onClose}>Shop Now</Btn></div>
  </div>);

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.8)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={e=>e.target===e.currentTarget&&step<5&&onClose()}>
      <div style={{background:"#fff",borderRadius:20,padding:"26px",width:"100%",maxWidth:520,maxHeight:"90vh",overflowY:"auto",animation:"fadeIn .25s ease",boxShadow:"0 24px 60px rgba(0,0,0,.3)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <h3 style={{fontFamily:"Syne,sans-serif",fontSize:18,fontWeight:800,color:NV}}>🛒 Checkout</h3>
          {step<5&&<button onClick={onClose} style={{border:"none",background:"none",cursor:"pointer",fontSize:22,color:"#94a3b8"}}>✕</button>}
        </div>
        <div style={{display:"flex",gap:4,marginBottom:18}}>{STEPS.map((s,i)=><div key={s} style={{flex:1}}><div style={{height:3,borderRadius:4,background:step>i?T:"#e2e8f0",marginBottom:3}}/><div style={{fontSize:9,color:step>i?T:SL,fontWeight:600,textAlign:"center"}}>{s.toUpperCase()}</div></div>)}</div>

        {step===1&&(<>
          {vendorCount>1&&<div style={{background:"#fef9c3",border:"1.5px solid #fde68a",borderRadius:10,padding:"9px 13px",marginBottom:14,fontSize:12,color:"#92400e"}}>🛍️ Items from <strong>{vendorCount} vendors</strong> — single checkout with combined delivery</div>}
          {appliedPromo&&discount>0&&<div style={{background:"#dcfce7",border:"1.5px solid #86efac",borderRadius:10,padding:"9px 13px",marginBottom:14,fontSize:12,color:GR}}>🎉 <strong>{appliedPromo.title}</strong> — {cur}{discount} discount applied!</div>}
          <div style={{maxHeight:200,overflowY:"auto",marginBottom:14}}>
            {cart.map((item,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #f1f5f9"}}>
                <span style={{fontSize:13,color:NV}}>{item.emoji||"📦"} {item.name}</span>
                <div style={{textAlign:"right"}}>
                  <div style={{fontWeight:700,fontSize:13}}>{fmt(item.price,country)}</div>
                  <div style={{fontSize:10,color:AM}}>+{Math.floor(item.price*POINTS_PER_UNIT[country])} pts</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{background:"#f8fafc",borderRadius:10,padding:"10px 14px",marginBottom:14}}>
            {discount>0&&<><div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:SL,marginBottom:3}}><span>Subtotal</span><span>{cur}{subtotal.toFixed(2)}</span></div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:GR,marginBottom:3}}><span>🎉 Deal discount</span><span>-{cur}{discount}</span></div></>}
            <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:SL,marginBottom:3}}><span>After discount</span><span>{cur}{discountedSubtotal.toFixed(2)}</span></div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:SL}}><span>Reward points</span><span style={{color:AM}}>Granted after payment success</span></div>
          </div>
          <Btn primary full onClick={()=>setStep(2)}>Continue →</Btn>
        </>)}

        {step===2&&(<>
          <div style={{fontWeight:700,fontSize:14,color:NV,marginBottom:12}}>Delivery Address</div>
          <Inp label="Address Line 1" placeholder={country==="uk"?"12 Bow Road":"House 5, Road 12"} value={addr.line1} onChange={e=>setAddr(a=>({...a,line1:e.target.value}))}/>
          <Inp label="City / Area" placeholder={country==="uk"?"East London":"Gulshan"} value={addr.city} onChange={e=>setAddr(a=>({...a,city:e.target.value}))}/>
          {err&&<div style={{color:RD,fontSize:13,marginBottom:10,background:"#fee2e2",padding:"8px 12px",borderRadius:8}}>{err}</div>}
          <div style={{display:"flex",gap:10}}>
            <Btn onClick={()=>setStep(1)} style={{flex:1}}>← Back</Btn>
            <Btn primary onClick={findDrivers} disabled={!addr.line1||!addr.city||loading} style={{flex:2}}>{loading?"📡 Calculating...":"Find Drivers →"}</Btn>
          </div>
        </>)}

        {step===3&&quotes&&(<>
          <div style={{fontWeight:700,fontSize:14,color:NV,marginBottom:4}}>Choose Driver</div>
          <div style={{fontSize:12,color:SL,marginBottom:12}}>Distance: <strong>{dist} {unit}</strong></div>
          <div style={{display:"grid",gap:8,marginBottom:12}}>
            {quotes.map((d,i)=>(
              <div key={d.id} onClick={()=>setSel(d.id)} style={{border:`2px solid ${selDriver===d.id?T:"#e2e8f0"}`,borderRadius:10,padding:"10px 12px",cursor:"pointer",background:selDriver===d.id?TL:"#fff",display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:32,height:32,background:"#f1f5f9",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>🛵</div>
                <div style={{flex:1}}><div style={{fontWeight:700,fontSize:13,color:NV}}>{d.name} {i===0&&"💰"}</div><div style={{fontSize:11,color:SL}}>~{d.eta} min</div></div>
                <div style={{fontWeight:800,fontSize:15,color:T}}>{cur}{d.quote}</div>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:10}}>
            <Btn onClick={()=>setStep(2)} style={{flex:1}}>← Back</Btn>
            <Btn primary onClick={()=>setStep(4)} disabled={!selDriver} style={{flex:2}}>Payment →</Btn>
          </div>
        </>)}

        {step===4&&(()=>{
          const dr=quotes.find(q=>q.id===selDriver);
          const total=+(discountedSubtotal+(dr?.quote||0)).toFixed(2);
          return(<>
            <div style={{fontWeight:700,fontSize:14,color:NV,marginBottom:12}}>Payment</div>
            <div style={{background:"#f8fafc",borderRadius:10,padding:"10px 14px",marginBottom:14}}>
              {discount>0&&<div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:GR,marginBottom:3}}><span>Deal saving</span><span>-{cur}{discount}</span></div>}
              <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:SL,marginBottom:3}}><span>Items</span><span>{cur}{discountedSubtotal.toFixed(2)}</span></div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:SL,marginBottom:3}}><span>Delivery</span><span>{cur}{dr?.quote}</span></div>
              <div style={{display:"flex",justifyContent:"space-between",fontWeight:800,fontSize:16,color:NV,borderTop:"1px solid #e2e8f0",paddingTop:7,marginTop:5}}><span>Total</span><span>{cur}{total}</span></div>
              <div style={{fontSize:11,color:AM,marginTop:5}}>⭐ Loyalty points are credited after successful payment confirmation.</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
              {(country==="uk"?[["card","💳","Card"],["cash","💵","Cash"]]:[["bkash","📱","bKash"],["nagad","💜","Nagad"],["card","💳","Card"],["cash","💵","Cash"]]).map(([v,ic,lbl])=>(
                <div key={v} onClick={()=>setPay(v)} style={{border:`2px solid ${payment===v?T:"#e2e8f0"}`,borderRadius:10,padding:"9px",cursor:"pointer",background:payment===v?TL:"#fff",textAlign:"center"}}>
                  <div style={{fontSize:20}}>{ic}</div><div style={{fontSize:12,fontWeight:600,color:NV}}>{lbl}</div>
                </div>
              ))}
            </div>
            {payment==="card"&&!_accessToken&&(
              <div style={{background:"#fff7ed",border:"1px solid #fdba74",borderRadius:10,padding:"9px 12px",fontSize:12,color:"#9a3412",marginBottom:12}}>
                Card checkout requires an authenticated account session. Use API-backed login credentials, or choose a non-card payment method for demo mode.
              </div>
            )}
            <div style={{display:"flex",gap:10}}>
              <Btn onClick={()=>setStep(3)} style={{flex:1}}>← Back</Btn>
              <Btn primary onClick={confirmOrder} style={{flex:2}}>Place Order — {cur}{total} ✓</Btn>
            </div>
          </>);
        })()}

        {step===5&&(
          <div style={{textAlign:"center",padding:"10px 0"}}>
            <div style={{fontSize:52,marginBottom:12}}>🎉</div>
            <div style={{fontFamily:"Syne,sans-serif",fontSize:20,fontWeight:800,color:"#15803d",marginBottom:5}}>Order Confirmed!</div>
            <div style={{color:SL,fontSize:13,marginBottom:4}}>Order: <strong>{orderId}</strong></div>
            <div style={{background:"#fef9c3",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:"#92400e"}}>
              ⭐ Reward points are added after payment success confirmation.
            </div>
            <Btn primary onClick={onClose}>Done ✓</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  VENDOR DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════
function VendorDash({user,country,rates,products,setProducts,vendorOrders,updateVendorOrder,promos,setPromos,fire}){
  const [section,setSec]=useState("analytics");
  const [editItem,setEdit]=useState(null);
  const [form,setForm]=useState({name:"",price:"",emoji:"📦",cat:"",sizes:"",stock:"",color:"#ccfbf1"});
  const [promoForm,setPromoForm]=useState({title:"",desc:"",discount:"",type:"percent",minOrder:"",category:"Clothing",expiresIn:"86400",emoji:"🔥",color:"#dc2626"});
  const cur=CUR[country];
  const rateKey=user.vendorType||"ecommerce";
  const rateVal=rates[rateKey]?.value||10;
  const pendingOrders=vendorOrders.filter(o=>o.status==="pending").length;
  const FLOW=[["pending","accepted","Accept",T],["accepted","ready","Ready",AM],["ready","dispatched","Dispatch",PU],["dispatched","delivered","Delivered",GR]];
  const saveProduct=()=>{if(!form.name||!form.price)return;const p={name:form.name,price:+form.price,emoji:form.emoji,cat:form.cat,sizes:form.sizes.split(",").map(s=>s.trim()).filter(Boolean),stock:+form.stock||0,color:form.color,country,vendorId:user.id,reviews:[],sales:0,revenue:0};if(editItem==="new")setProducts(ps=>[...ps,{...p,id:Date.now()}]);else setProducts(ps=>ps.map(x=>x.id===editItem.id?{...x,...p}:x));setEdit(null);};
  const submitPromo=()=>{if(!promoForm.title||!promoForm.discount)return;const p={id:"p_"+Date.now(),vendorId:user.id,vendorName:user.name,...promoForm,discount:+promoForm.discount,minOrder:+promoForm.minOrder,expiresIn:+promoForm.expiresIn,country,status:"pending",createdAt:"Just now"};setPromos(ps=>[...ps,p]);fire("📋 Promo submitted for admin approval!");setPromoForm({title:"",desc:"",discount:"",type:"percent",minOrder:"",category:"Clothing",expiresIn:"86400",emoji:"🔥",color:"#dc2626"});};
  const EMOJIS=["👕","🔵","🟠","🧥","🩳","🎧","📦","🛍️","🌿","🍎"];
  const myPromos=promos.filter(p=>p.vendorId===user.id);

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
        <div style={{width:44,height:44,background:TL,borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>{user.avatar}</div>
        <div><h2 style={{fontFamily:"Syne,sans-serif",fontSize:21,fontWeight:800,color:NV}}>{user.name}</h2>
          <p style={{color:SL,fontSize:12}}>{FLAG[country]} Vendor · {rateVal}% commission</p></div>
      </div>
      <div style={{display:"flex",gap:7,marginBottom:18,flexWrap:"wrap"}}>
        {[["analytics","📊 Analytics"],["orders","📦 Orders"+(pendingOrders>0?` (${pendingOrders})`:"")],["products","🛍️ Products"],["promos","🎉 Promotions"]].map(([id,lbl])=>(
          <button key={id} onClick={()=>setSec(id)} style={{background:section===id?NV:"#fff",border:`1.5px solid ${section===id?NV:"#e2e8f0"}`,color:section===id?"#fff":SL,borderRadius:9,padding:"7px 14px",cursor:"pointer",fontWeight:600,fontSize:12,position:"relative"}}>
            {lbl}
            {id==="orders"&&pendingOrders>0&&section!=="orders"&&<span style={{position:"absolute",top:-5,right:-5,background:RD,color:"#fff",borderRadius:"50%",width:14,height:14,fontSize:8,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800}}>{pendingOrders}</span>}
          </button>
        ))}
      </div>

      {section==="analytics"&&<VendorAnalytics user={user} country={country} products={products.filter(p=>p.vendorId===user.id||p.vendorId==="a2")} vendorOrders={vendorOrders} rates={rates}/>}

      {section==="orders"&&(
        <div>
          <div style={{fontWeight:700,fontSize:15,color:NV,marginBottom:12}}>Incoming Orders ({vendorOrders.length})</div>
          {vendorOrders.length===0&&<div style={{...card({textAlign:"center",color:"#94a3b8",padding:40})}}>No orders yet.</div>}
          {vendorOrders.map(order=>{
            const flowAction=FLOW.find(([from])=>from===order.status);
            return(
              <div key={order.id} style={{...card({marginBottom:12}),borderLeft:`4px solid ${order.status==="pending"?AM:order.status==="delivered"?GR:T}`}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,flexWrap:"wrap",gap:8}}>
                  <div><div style={{fontWeight:800,fontSize:14,color:NV}}>{order.id}</div><div style={{fontSize:12,color:SL}}>👤 {order.customer} · {order.placed}</div></div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontWeight:800,fontSize:16,color:NV}}>{CUR[order.country||"uk"]}{order.total}</span>
                    {flowAction&&<Btn small primary onClick={()=>updateVendorOrder(order.id,flowAction[1])} style={{background:flowAction[3],borderColor:flowAction[3]}}>{flowAction[2]}</Btn>}
                    {order.status==="pending"&&<Btn small danger onClick={()=>updateVendorOrder(order.id,"rejected")}>Reject</Btn>}
                  </div>
                </div>
                <div style={{background:"#f8fafc",borderRadius:8,padding:"8px 12px"}}>
                  {order.items.map((item,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"4px 0",borderBottom:i<order.items.length-1?"1px solid #f1f5f9":"none"}}><span>{item.emoji||"📦"} {item.name} ×{item.qty||1}</span><span>{CUR[order.country||"uk"]}{item.price}</span></div>)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {section==="products"&&(
        <div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <div style={{fontWeight:700,fontSize:15,color:NV}}>Products ({products.filter(p=>p.vendorId===user.id||p.vendorId==="a2").length})</div>
            <Btn primary small onClick={()=>{setForm({name:"",price:"",emoji:"📦",cat:"",sizes:"S,M,L",stock:"10",color:"#ccfbf1"});setEdit("new");}}>+ Add Product</Btn>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(195px,1fr))",gap:12}}>
            {(products.filter(p=>p.vendorId===user.id||p.vendorId==="a2")).map(p=>(
              <div key={p.id} style={{...card({padding:14})}}>
                <div style={{height:75,background:p.color||"#f1f5f9",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:38,marginBottom:10,position:"relative"}}>
                  {p.emoji}
                  <div style={{position:"absolute",top:5,right:5}}><Pill bg={p.stock>10?"#dcfce7":p.stock>0?"#fef9c3":"#fee2e2"} color={p.stock>10?GR:p.stock>0?"#a16207":RD} style={{fontSize:9}}>×{p.stock}</Pill></div>
                </div>
                <div style={{fontWeight:600,fontSize:13,color:NV,marginBottom:2}}>{p.name}</div>
                <div style={{fontSize:11,color:SL,marginBottom:6}}>{p.cat} · {cur}{p.price}</div>
                <div style={{display:"flex",gap:5}}>
                  <Btn small onClick={()=>{setForm({name:p.name,price:p.price,emoji:p.emoji,cat:p.cat,sizes:(p.sizes||[]).join(","),stock:p.stock,color:p.color||"#ccfbf1"});setEdit(p);}} style={{flex:1}}>Edit</Btn>
                  <Btn small danger onClick={()=>setProducts(ps=>ps.filter(x=>x.id!==p.id))} style={{flex:1}}>Del</Btn>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {section==="promos"&&(
        <div>
          {/* Create promo form */}
          <div style={{...card({marginBottom:16})}}>
            <div style={{fontWeight:700,fontSize:15,color:NV,marginBottom:4}}>🎉 Create a Flash Deal</div>
            <p style={{color:SL,fontSize:13,marginBottom:14}}>Submit a promotion for admin review. Approved promos appear on the home banner strip.</p>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <Inp label="Deal Title" placeholder="Summer Flash Sale" value={promoForm.title} onChange={e=>setPromoForm(f=>({...f,title:e.target.value}))}/>
              <Inp label="Emoji" value={promoForm.emoji} onChange={e=>setPromoForm(f=>({...f,emoji:e.target.value}))} style={{fontSize:20}}/>
            </div>
            <Inp label="Description" placeholder="20% off all clothing today only!" value={promoForm.desc} onChange={e=>setPromoForm(f=>({...f,desc:e.target.value}))}/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
              <Inp label="Discount Amount" type="number" value={promoForm.discount} onChange={e=>setPromoForm(f=>({...f,discount:e.target.value}))}/>
              <Sel label="Type" value={promoForm.type} onChange={e=>setPromoForm(f=>({...f,type:e.target.value}))} options={[{v:"percent",l:"Percentage (%)"},{v:"fixed",l:`Fixed (${cur})`}]}/>
              <Inp label={`Min Order (${cur})`} type="number" value={promoForm.minOrder} onChange={e=>setPromoForm(f=>({...f,minOrder:e.target.value}))}/>
            </div>
            <Sel label="Duration" value={promoForm.expiresIn} onChange={e=>setPromoForm(f=>({...f,expiresIn:e.target.value}))} options={[{v:"3600",l:"1 Hour"},{v:"14400",l:"4 Hours"},{v:"86400",l:"24 Hours"},{v:"259200",l:"3 Days"},{v:"604800",l:"1 Week"}]}/>
            <Btn primary full onClick={submitPromo} disabled={!promoForm.title||!promoForm.discount}>Submit for Approval 📋</Btn>
          </div>

          {/* My promos */}
          <div style={{fontWeight:700,fontSize:15,color:NV,marginBottom:12}}>My Promotions ({myPromos.length})</div>
          {myPromos.length===0&&<div style={{...card({textAlign:"center",color:"#94a3b8",padding:30})}}>No promotions yet. Create one above!</div>}
          {myPromos.map(p=>(
            <div key={p.id} style={{...card({marginBottom:10}),display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
              <span style={{fontSize:28}}>{p.emoji}</span>
              <div style={{flex:1,minWidth:160}}><div style={{fontWeight:700,fontSize:14,color:NV}}>{p.title}</div><div style={{fontSize:12,color:SL}}>{p.desc}</div></div>
              <Pill bg="#f1f5f9" color="#475569" style={{fontSize:11}}>{p.type==="percent"?`${p.discount}%`:`${cur}${p.discount}`} off</Pill>
              <SBadge s={p.status}/>
              {p.status==="pending"&&<span style={{fontSize:11,color:SL}}>Awaiting admin review</span>}
            </div>
          ))}
        </div>
      )}

      {/* Product edit modal */}
      {editItem!==null&&(
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.8)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div style={{background:"#fff",borderRadius:20,padding:"24px",width:"100%",maxWidth:440,animation:"fadeIn .2s ease",boxShadow:"0 24px 60px rgba(0,0,0,.3)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <h3 style={{fontFamily:"Syne,sans-serif",fontSize:16,fontWeight:800,color:NV}}>{editItem==="new"?"Add Product":"Edit Product"}</h3>
              <button onClick={()=>setEdit(null)} style={{border:"none",background:"none",cursor:"pointer",fontSize:22,color:"#94a3b8"}}>✕</button>
            </div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:12}}>{EMOJIS.map(e=><button key={e} onClick={()=>setForm(f=>({...f,emoji:e}))} style={{width:30,height:30,border:`2px solid ${form.emoji===e?T:"#e2e8f0"}`,borderRadius:7,cursor:"pointer",fontSize:16,background:form.emoji===e?TL:"#fff"}}>{e}</button>)}</div>
            <Inp label="Name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <Inp label={`Price (${cur})`} type="number" value={form.price} onChange={e=>setForm(f=>({...f,price:e.target.value}))}/>
              <Inp label="Stock" type="number" value={form.stock} onChange={e=>setForm(f=>({...f,stock:e.target.value}))}/>
            </div>
            <Inp label="Category" value={form.cat} onChange={e=>setForm(f=>({...f,cat:e.target.value}))}/>
            <Inp label="Sizes (comma separated)" value={form.sizes} onChange={e=>setForm(f=>({...f,sizes:e.target.value}))}/>
            <div style={{display:"flex",gap:10,marginTop:4}}>
              <Btn onClick={()=>setEdit(null)} style={{flex:1}}>Cancel</Btn>
              <Btn primary onClick={saveProduct} disabled={!form.name||!form.price} style={{flex:2}}>{editItem==="new"?"Add ✓":"Save ✓"}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  ADMIN PANEL — with promo management
// ═══════════════════════════════════════════════════════════════════════════
function AdminPanel({vendors,updateVendor,drivers,updateDriver,rates,setRates,promos,approvePromo,rejectPromo,orders}){
  const [sec,setSec]=useState("overview");
  const [editRates,setER]=useState(JSON.parse(JSON.stringify(rates)));
  const [saved,setSaved]=useState(false);
  const saveRates=()=>{setRates(editRates);setSaved(true);setTimeout(()=>setSaved(false),2500);};
  const SECS=[{id:"overview",icon:"📊",label:"Overview"},{id:"vendors",icon:"🏪",label:"Vendors"},{id:"drivers",icon:"🛵",label:"Drivers"},{id:"promos",icon:"🎉",label:"Promotions"},{id:"rates",icon:"💰",label:"Commission"},{id:"orders",icon:"📦",label:"Orders"}];
  const pendingPromos=promos.filter(p=>p.status==="pending");
  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <div style={{width:38,height:38,background:PU,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>⚙️</div>
        <div><h2 style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:800,color:NV}}>Admin Panel</h2>
          <p style={{color:SL,fontSize:13}}>LocalHub · UK & Bangladesh · {pendingPromos.length} promo{pendingPromos.length!==1?"s":""} pending</p></div>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:20,flexWrap:"wrap"}}>
        {SECS.map(s=><button key={s.id} onClick={()=>setSec(s.id)} style={{background:sec===s.id?NV:"#fff",border:`1.5px solid ${sec===s.id?NV:"#e2e8f0"}`,color:sec===s.id?"#fff":SL,borderRadius:9,padding:"6px 12px",cursor:"pointer",fontWeight:600,fontSize:12,display:"flex",alignItems:"center",gap:4,position:"relative"}}>
          <span>{s.icon}</span><span>{s.label}</span>
          {s.id==="promos"&&pendingPromos.length>0&&sec!=="promos"&&<span style={{position:"absolute",top:-5,right:-5,background:RD,color:"#fff",borderRadius:"50%",width:14,height:14,fontSize:8,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800}}>{pendingPromos.length}</span>}
        </button>)}
      </div>

      {sec==="overview"&&["uk","bd"].map(c=>(
        <div key={c} style={{marginBottom:22}}>
          <div style={{fontFamily:"Syne,sans-serif",fontSize:16,fontWeight:800,color:NV,marginBottom:12}}>{FLAG[c]} {c==="uk"?"United Kingdom":"Bangladesh"}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10}}>
            <StatBox icon="👥" label="Users"      value={ADMIN_STATS[c].users.toLocaleString()} color="#2563eb"/>
            <StatBox icon="🏪" label="Vendors"    value={ADMIN_STATS[c].vendors}                color={PU}/>
            <StatBox icon="🛵" label="Drivers"    value={ADMIN_STATS[c].drivers}                color={T}/>
            <StatBox icon="📦" label="Orders"     value={ADMIN_STATS[c].orders.toLocaleString()}color={AM}/>
            <StatBox icon="💳" label="Commission" value={`${CUR[c]}${ADMIN_STATS[c].commission.toLocaleString()}`} color={GR}/>
          </div>
        </div>
      ))}

      {sec==="vendors"&&vendors.map(v=>(
        <div key={v.id} style={{...card({marginBottom:10}),display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <div style={{width:36,height:36,background:"#f1f5f9",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🏪</div>
          <div style={{flex:1,minWidth:150}}><div style={{fontWeight:700,fontSize:13,color:NV}}>{v.name}</div><div style={{fontSize:11,color:SL}}>{FLAG[v.country]} {v.type} · {v.joined}</div></div>
          <div style={{display:"flex",gap:14}}>
            <div><div style={{fontWeight:700,fontSize:12}}>{CUR[v.country]}{v.sales.toLocaleString()}</div><div style={{fontSize:10,color:SL}}>Sales</div></div>
            <div><div style={{fontWeight:700,fontSize:12,color:T}}>{CUR[v.country]}{v.commission.toLocaleString()}</div><div style={{fontSize:10,color:SL}}>Commission</div></div>
          </div>
          <SBadge s={v.status}/>
          <div style={{display:"flex",gap:6}}>
            {v.status!=="active"&&<Btn small primary onClick={()=>updateVendor(v.id,{status:"active"})}>Approve</Btn>}
            {v.status!=="suspended"&&<Btn small danger onClick={()=>updateVendor(v.id,{status:"suspended"})}>Suspend</Btn>}
          </div>
        </div>
      ))}

      {sec==="drivers"&&drivers.map(d=>(
        <div key={d.id} style={{...card({marginBottom:10}),display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <div style={{width:36,height:36,background:TL,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🛵</div>
          <div style={{flex:1,minWidth:150}}><div style={{fontWeight:700,fontSize:13,color:NV}}>{d.name}</div><div style={{fontSize:11,color:SL}}>{FLAG[d.country]} {d.vehicle} · {d.trips} trips</div></div>
          <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:7,height:7,borderRadius:"50%",background:d.isOnline?GR:"#94a3b8"}}/><span style={{fontSize:11,color:SL}}>{d.isOnline?"Online":"Offline"}</span></div>
          <SBadge s={d.status}/>
          <div style={{display:"flex",gap:6}}>
            {d.status!=="active"&&<Btn small primary onClick={()=>updateDriver(d.id,{status:"active"})}>Approve</Btn>}
            {d.status!=="suspended"&&<Btn small danger onClick={()=>updateDriver(d.id,{status:"suspended"})}>Suspend</Btn>}
          </div>
        </div>
      ))}

      {sec==="promos"&&(
        <div>
          <div style={{fontWeight:700,fontSize:15,color:NV,marginBottom:14}}>Promotions ({promos.length}) · {pendingPromos.length} pending review</div>
          {promos.map(p=>(
            <div key={p.id} style={{...card({marginBottom:10}),borderLeft:`4px solid ${p.status==="active"?GR:p.status==="pending"?AM:RD}`}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                    <span style={{fontSize:22}}>{p.emoji}</span>
                    <div style={{fontWeight:700,fontSize:14,color:NV}}>{p.title}</div>
                    <SBadge s={p.status}/>
                    {FLAG[p.country]&&<Pill bg="#f1f5f9" color="#475569" style={{fontSize:10}}>{FLAG[p.country]} {p.country.toUpperCase()}</Pill>}
                  </div>
                  <div style={{fontSize:12,color:SL,marginBottom:4}}>{p.desc}</div>
                  <div style={{fontSize:12,color:SL}}>By <strong>{p.vendorName}</strong> · {p.type==="percent"?`${p.discount}%`:`${CUR[p.country]}${p.discount}`} off · Min order {CUR[p.country]}{p.minOrder}</div>
                </div>
                {p.status==="pending"&&(
                  <div style={{display:"flex",gap:8}}>
                    <Btn small primary onClick={()=>approvePromo(p.id)}>✓ Approve</Btn>
                    <Btn small danger onClick={()=>rejectPromo(p.id)}>✕ Reject</Btn>
                  </div>
                )}
                {p.status==="active"&&<Pill bg="#dcfce7" color={GR} style={{fontSize:11}}>🔥 Live Now</Pill>}
              </div>
            </div>
          ))}
        </div>
      )}

      {sec==="rates"&&(
        <div style={{maxWidth:600}}>
          <div style={{fontWeight:700,color:NV,fontSize:15,marginBottom:12}}>Dynamic Commission Rates</div>
          {Object.entries(editRates).map(([key,r])=>(
            <div key={key} style={{...card({marginBottom:10}),display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <div style={{flex:1,minWidth:160}}><div style={{fontWeight:700,fontSize:13,color:NV}}>{r.label}</div><div style={{fontSize:11,color:SL}}>{r.type==="percent"?"% per transaction":"Fixed weekly fee"}</div></div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <input type="number" min={0} max={r.type==="percent"?100:9999} step={r.type==="percent"?.5:1} value={editRates[key].value}
                  onChange={e=>setER(prev=>({...prev,[key]:{...prev[key],value:+e.target.value}}))}
                  style={{width:78,padding:"7px 10px",border:"1.5px solid #e2e8f0",borderRadius:10,fontSize:14,fontWeight:700,textAlign:"center",fontFamily:"inherit"}}/>
                <span style={{fontWeight:700,color:SL}}>{r.type==="percent"?"%":r.type==="fixed_uk"?"£":"৳"}</span>
              </div>
            </div>
          ))}
          <div style={{display:"flex",gap:10,marginTop:12,alignItems:"center"}}>
            <Btn primary onClick={saveRates}>Save All 💾</Btn>
            <Btn onClick={()=>setER(JSON.parse(JSON.stringify(DEFAULT_RATES)))}>Reset</Btn>
            {saved&&<Pill bg="#dcfce7" color={GR} style={{fontSize:12,padding:"6px 12px"}}>✓ Applied!</Pill>}
          </div>
        </div>
      )}

      {sec==="orders"&&(
        <div>
          <div style={{fontWeight:700,color:NV,fontSize:15,marginBottom:12}}>Recent Orders ({orders.length})</div>
          {orders.length===0&&<div style={{...card({textAlign:"center",color:"#94a3b8",padding:40})}}>No orders yet.</div>}
          {orders.slice(0,20).map(o=>(
            <div key={o.id} style={{...card({padding:"11px 14px",marginBottom:8}),display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <div style={{flex:1,minWidth:150}}><div style={{fontWeight:700,fontSize:12,color:NV}}>{o.id}</div><div style={{fontSize:11,color:SL}}>{o.customer||"Customer"} · {o.placed||o.time}</div></div>
              <div style={{fontWeight:800,fontSize:13}}>{CUR[o.country||"uk"]}{o.total}</div>
              <SBadge s={o.status}/>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  DRIVER DASHBOARD (compact)
// ═══════════════════════════════════════════════════════════════════════════
function DriverDash({user,drivers,updateDriver,country,rates}){
  const driver=drivers.find(d=>d.id===user.driverId)||drivers[0];
  const [pricing,setPricing]=useState({...driver.pricing});
  const [saved,setSaved]=useState(false);
  const cur=CUR[country],unit=country==="uk"?"miles":"km";
  const exQ=Math.max(pricing.min,pricing.base+3*pricing.perUnit).toFixed(2);
  const save=()=>{updateDriver(driver.id,{pricing:{...pricing}});setSaved(true);setTimeout(()=>setSaved(false),2500);};
  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18}}>
        <div style={{width:44,height:44,background:TL,borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>🛵</div>
        <div><h2 style={{fontFamily:"Syne,sans-serif",fontSize:21,fontWeight:800,color:NV}}>{driver.name}</h2>
          <p style={{color:SL,fontSize:13}}>{FLAG[country]} · {driver.vehicle} · ★{driver.rating}</p></div>
        <button onClick={()=>updateDriver(driver.id,{isOnline:!driver.isOnline})} style={{marginLeft:"auto",background:driver.isOnline?GR:SL,border:"none",color:"#fff",borderRadius:20,padding:"7px 16px",cursor:"pointer",fontWeight:700,fontSize:13}}>
          {driver.isOnline?"🟢 Online":"⚫ Offline"}
        </button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:12,marginBottom:20}}>
        <StatBox icon="💰" label="Total Earned" value={`${cur}${driver.earnings.total.toLocaleString()}`} color={GR}/>
        <StatBox icon="📅" label="This Month"   value={`${cur}${driver.earnings.month}`}                  color={T}/>
        <StatBox icon="🏦" label="Platform Fee" value={`${cur}${driver.earnings.commission.toLocaleString()}`} color={RD}/>
        <StatBox icon="📦" label="Total Trips"  value={driver.trips.toLocaleString()}                     color={PU}/>
      </div>
      <div style={{...card()}}>
        <div style={{fontFamily:"Syne,sans-serif",fontSize:15,fontWeight:800,color:NV,marginBottom:4}}>⚙️ My Pricing</div>
        <p style={{color:SL,fontSize:12,marginBottom:16}}>Quote = max(min, base + dist × per-{unit} rate)</p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          {[["Base Charge",cur,"base"],["Per "+unit.charAt(0).toUpperCase()+unit.slice(1),cur+"/"+unit,"perUnit"],["Min Charge",cur,"min"],["Max Dist",unit,"maxDist"]].map(([lbl,sfx,key])=>(
            <div key={key}>
              <div style={{fontSize:11,fontWeight:700,color:SL,marginBottom:4}}>{lbl} ({sfx})</div>
              <input type="number" min={0} step={0.05} value={pricing[key]} onChange={e=>setPricing(p=>({...p,[key]:+e.target.value}))}
                style={{width:"100%",padding:"8px 12px",border:"1.5px solid #e2e8f0",borderRadius:10,fontSize:14,fontWeight:700,fontFamily:"inherit"}}/>
            </div>
          ))}
        </div>
        <div style={{background:"#f0fdf4",border:"1.5px solid #86efac",borderRadius:10,padding:"10px 14px",marginTop:14,fontSize:13,color:"#166534"}}>
          Preview (3 {unit}): <strong>{cur}{exQ}</strong> · You keep: <strong>{cur}{(+exQ*(1-rates.delivery.value/100)).toFixed(2)}</strong>
        </div>
        <div style={{display:"flex",gap:10,marginTop:12,alignItems:"center"}}>
          <Btn primary onClick={save}>Save 💾</Btn>
          {saved&&<Pill bg="#dcfce7" color={GR}>✓ Live!</Pill>}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  AUTH MODALS
// ═══════════════════════════════════════════════════════════════════════════
function LoginModal({accounts,onLogin,onClose,onSwitch}){
  const [email,setEmail]=useState(""),[pass,setPass]=useState(""),[errMsg,setErrMsg]=useState(""),[loading,setLoading]=useState(false);
  const attempt=async()=>{
    setErrMsg("");setLoading(true);
    try{
      const data=await API.login(email,pass);
      // Map API response to app user shape
      const avatarMap={customer:"🛒",vendor:"🏪",driver:"🛵",job_seeker:"💼",admin:"👑"};
      onLogin({...data.user,accessToken:data.accessToken,avatar:data.user.avatar||avatarMap[data.user.role]||"👤",points:data.user.loyaltyPoints||0,credits:data.user.loyaltyCredits||0,referralCode:data.user.referralCode||""});
    }catch(e){
      // Fallback to demo accounts if API fails
      const emailNorm=(email||"").trim().toLowerCase();
      const passNorm=(pass||"").trim();
      const u=accounts.find(a=>(a.email||"").trim().toLowerCase()===emailNorm&&a.password===passNorm);
      if(u){onLogin(u);}else{setErrMsg(e.message||"Invalid email or password");}
    }finally{setLoading(false);}
  };
  return(
    <ModalWrap onClose={onClose}>
      <h2 style={{fontFamily:"Syne,sans-serif",fontSize:20,fontWeight:800,color:NV,marginBottom:4}}>Welcome back</h2>
      <div style={{background:"#f8fafc",borderRadius:12,padding:"11px",marginBottom:14}}>
        <div style={{fontSize:10,fontWeight:700,color:SL,marginBottom:7}}>⚡ DEMO ACCOUNTS</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
          {DEMO_ACCOUNTS.map(acc=>(
            <button key={acc.id} onClick={()=>onLogin(acc)} style={{border:"1.5px solid #e2e8f0",borderRadius:9,padding:"7px 9px",cursor:"pointer",background:"#fff",textAlign:"left",fontFamily:"inherit"}}>
              <div style={{fontSize:15,marginBottom:1}}>{acc.avatar}</div>
              <div style={{fontWeight:700,fontSize:10,color:NV}}>{acc.name}</div>
              <div style={{fontSize:9,color:SL}}>{FLAG[acc.country]} {acc.role} {acc.points>0&&`· ⭐${acc.points.toLocaleString()}pts`}</div>
            </button>
          ))}
        </div>
      </div>
      <Inp label="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)}/>
      <Inp label="Password" type="password" value={pass} onChange={e=>setPass(e.target.value)} style={{}} />
      {errMsg&&<div style={{color:RD,fontSize:12,marginBottom:10,background:"#fee2e2",padding:"8px 12px",borderRadius:8}}>{errMsg}</div>}
      <Btn primary full onClick={attempt} disabled={loading}>{loading?"Signing in...":"Log In"}</Btn>
      <div style={{textAlign:"center",marginTop:10,fontSize:13,color:SL}}>No account? <button onClick={onSwitch} style={{background:"none",border:"none",color:T,fontWeight:700,cursor:"pointer",fontSize:13}}>Sign Up</button></div>
    </ModalWrap>
  );
}

function SignupModal({jobCats,onSignup,onClose,onSwitch}){
  const [step,setStep]=useState(1);
  const [f,setF]=useState({name:"",email:"",password:"",country:"uk",role:"customer",selectedCats:[],refCode:""});
  const set=(k,v)=>setF(p=>({...p,[k]:v}));
  const avatarMap={customer:"🛒",vendor:"🏪",driver:"🛵",job_seeker:"💼"};
  const [submitErr,setSubmitErr]=useState(""),[submitting,setSubmitting]=useState(false);
  const submit=async()=>{
    if(!f.name||!f.email||!f.password)return;
    setSubmitErr("");setSubmitting(true);
    try{
      const data=await API.signup({name:f.name,email:f.email,password:f.password,country:f.country,role:f.role,referralCode:f.refCode||undefined});
      const avatarM={customer:"🛒",vendor:"🏪",driver:"🛵",job_seeker:"💼",admin:"👑"};
      onSignup({...data.user,accessToken:data.accessToken,avatar:data.user.avatar||avatarM[data.user.role]||"👤",points:data.user.loyaltyPoints||0,credits:data.user.loyaltyCredits||0,referralCode:data.user.referralCode||makeCode(f.name),referralCount:0});
    }catch(e){
      // Fallback: create local user if API fails
      if(e.status===409){setSubmitErr("An account with this email already exists.");setSubmitting(false);return;}
      const avatarM={customer:"🛒",vendor:"🏪",driver:"🛵",job_seeker:"💼"};
      onSignup({...f,id:"u_"+Date.now(),avatar:avatarM[f.role]||"👤",points:f.refCode?500:0,credits:f.refCode?5:0,referralCode:makeCode(f.name),referralCount:0});
    }finally{setSubmitting(false);}
  };
  return(
    <ModalWrap onClose={onClose} wide>
      <div style={{display:"flex",gap:5,marginBottom:18}}>{[1,2,3].map(n=><div key={n} style={{flex:1,height:4,borderRadius:4,background:step>=n?T:"#e2e8f0"}}/>)}</div>
      {step===1&&(<>
        <h2 style={{fontFamily:"Syne,sans-serif",fontSize:19,fontWeight:800,color:NV,marginBottom:4}}>Create account</h2>
        <Inp label="Full Name" value={f.name} onChange={e=>set("name",e.target.value)}/>
        <Inp label="Email" type="email" value={f.email} onChange={e=>set("email",e.target.value)}/>
        <Inp label="Password" type="password" value={f.password} onChange={e=>set("password",e.target.value)}/>
        <Inp label="Referral Code (optional)" placeholder="e.g. SARA5678" value={f.refCode} onChange={e=>set("refCode",e.target.value.toUpperCase())} style={{letterSpacing:2,fontWeight:700}}/>
        {f.refCode&&<div style={{background:"#dcfce7",borderRadius:8,padding:"8px 12px",marginBottom:10,fontSize:12,color:GR}}>🎉 Referral code applied! You'll get £5 credit + 500 bonus points after your first order.</div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
          {[["customer","🛒","Customer"],["vendor","🏪","Vendor"],["driver","🛵","Driver"],["job_seeker","💼","Job Seeker"]].map(([r,ic,lbl])=>(
            <div key={r} onClick={()=>set("role",r)} style={{border:`2px solid ${f.role===r?T:"#e2e8f0"}`,borderRadius:10,padding:"9px",cursor:"pointer",background:f.role===r?TL:"#fff",textAlign:"center"}}>
              <div style={{fontSize:22,marginBottom:2}}>{ic}</div><div style={{fontWeight:700,fontSize:12,color:NV}}>{lbl}</div>
            </div>
          ))}
        </div>
        <Btn primary full onClick={()=>f.name&&f.email?setStep(2):null}>Continue →</Btn>
        <div style={{textAlign:"center",marginTop:10,fontSize:12,color:SL}}>Have account? <button onClick={onSwitch} style={{background:"none",border:"none",color:T,fontWeight:700,cursor:"pointer",fontSize:12}}>Log In</button></div>
      </>)}
      {step===2&&(<>
        <h2 style={{fontFamily:"Syne,sans-serif",fontSize:19,fontWeight:800,color:NV,marginBottom:4}}>Select country</h2>
        {[["uk","🇬🇧","United Kingdom","GBP £"],["bd","🇧🇩","Bangladesh","BDT ৳"]].map(([c,fl,nm,sub])=>(
          <div key={c} onClick={()=>set("country",c)} style={{border:`2px solid ${f.country===c?T:"#e2e8f0"}`,borderRadius:12,padding:"13px 16px",cursor:"pointer",marginBottom:10,background:f.country===c?TL:"#fff",display:"flex",alignItems:"center",gap:12}}>
            <span style={{fontSize:30}}>{fl}</span>
            <div style={{flex:1}}><div style={{fontWeight:700,fontSize:13,color:NV}}>{nm}</div><div style={{fontSize:11,color:SL}}>{sub}</div></div>
            {f.country===c&&<span style={{color:T,fontSize:18}}>✓</span>}
          </div>
        ))}
        <div style={{display:"flex",gap:10,marginTop:6}}>
          <Btn onClick={()=>setStep(1)} style={{flex:1}}>← Back</Btn>
          <Btn primary onClick={()=>setStep(3)} style={{flex:2}}>Continue →</Btn>
        </div>
      </>)}
      {step===3&&(<>
        <h2 style={{fontFamily:"Syne,sans-serif",fontSize:19,fontWeight:800,color:NV,marginBottom:4}}>Almost done!</h2>
        <p style={{color:SL,fontSize:13,lineHeight:1.7,marginBottom:16}}>
          {f.role==="driver"?"Set up your vehicle and pricing from your Driver Dashboard.":f.role==="vendor"?"Your listings only show to local customers in your country.":"Everything within 5–10 miles of you. Earn loyalty points on every order!"}
        </p>
        {f.refCode&&<div style={{background:"#dcfce7",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:13,color:GR}}>⭐ Referral bonus ready: £5 credit + 500 pts after your first order!</div>}
        <div style={{display:"flex",gap:10}}>
          <Btn onClick={()=>setStep(2)} style={{flex:1}}>← Back</Btn>
          {submitErr&&<div style={{color:RD,fontSize:12,marginBottom:8,background:"#fee2e2",padding:"8px 12px",borderRadius:8}}>{submitErr}</div>}
        <Btn primary onClick={submit} disabled={submitting} style={{flex:2}}>{submitting?"Creating...":"Create Account 🎉"}</Btn>
        </div>
      </>)}
    </ModalWrap>
  );
}

function PostJobModal({jobCats,country,onCreate,onClose}){
  const [f,setF]=useState({title:"",company:"",location:"",salary:"",categoryId:jobCats[0]?.id||1,minExp:0,description:"",isUrgent:false,weeks:1});
  const [saving,setSaving]=useState(false);
  const set=(k,v)=>setF(p=>({...p,[k]:v}));
  const submit=async()=>{
    if(!f.title||!f.company||!f.location||!f.salary||!f.description) return;
    setSaving(true);
    await onCreate({
      title:f.title,
      company:f.company,
      location:f.location,
      salary:f.salary,
      categoryId:Number(f.categoryId),
      minExp:Number(f.minExp||0),
      description:f.description,
      isUrgent:Boolean(f.isUrgent),
      weeks:Number(f.weeks||1),
      country,
    });
    setSaving(false);
  };
  return(
    <ModalWrap onClose={onClose} wide>
      <h2 style={{fontFamily:"Syne,sans-serif",fontSize:19,fontWeight:800,color:NV,marginBottom:6}}>Post a Job</h2>
      <div style={{fontSize:12,color:SL,marginBottom:14}}>Available for all account roles.</div>
      <Inp label="Job Title" value={f.title} onChange={e=>set("title",e.target.value)}/>
      <Inp label="Company" value={f.company} onChange={e=>set("company",e.target.value)}/>
      <Inp label="Location" value={f.location} onChange={e=>set("location",e.target.value)}/>
      <Inp label="Salary" value={f.salary} onChange={e=>set("salary",e.target.value)} placeholder={country==="uk"?"£12-15/hr":"৳25,000/mo"}/>
      <Sel label="Category" value={f.categoryId} onChange={e=>set("categoryId",e.target.value)} options={jobCats.map(c=>({v:c.id,l:`${c.icon} ${c.name}`}))}/>
      <Inp label="Minimum Experience (years)" type="number" min={0} value={f.minExp} onChange={e=>set("minExp",e.target.value)}/>
      <Inp label="Description" value={f.description} onChange={e=>set("description",e.target.value)}/>
      <Sel label="Listing Duration" value={f.weeks} onChange={e=>set("weeks",e.target.value)} options={[{v:1,l:"1 week"},{v:2,l:"2 weeks"},{v:4,l:"4 weeks"}]}/>
      <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:NV,fontWeight:600,marginBottom:16}}>
        <input type="checkbox" checked={f.isUrgent} onChange={e=>set("isUrgent",e.target.checked)}/>
        Mark as urgent
      </label>
      <div style={{display:"flex",gap:10}}>
        <Btn onClick={onClose} style={{flex:1}}>Cancel</Btn>
        <Btn primary onClick={submit} disabled={saving} style={{flex:2}}>{saving?"Posting...":"Post Job"}</Btn>
      </div>
    </ModalWrap>
  );
}

function ModalWrap({children,onClose,wide}){
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.78)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"#fff",borderRadius:20,padding:"24px",width:"100%",maxWidth:wide?500:430,maxHeight:"90vh",overflowY:"auto",animation:"fadeIn .25s ease",boxShadow:"0 24px 60px rgba(0,0,0,.3)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{fontFamily:"Syne,sans-serif",fontSize:18,fontWeight:800}}><span style={{color:T}}>LOCAL</span><span style={{color:AM}}>HUB</span></div>
          <button onClick={onClose} style={{border:"none",background:"none",cursor:"pointer",fontSize:22,color:"#94a3b8"}}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}


// Force server-side rendering — this app requires client-side interactivity
export function getServerSideProps() {
  return { props: {} };
}
