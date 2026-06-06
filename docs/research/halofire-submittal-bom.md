# Halo Fire — Materials Submittal BOM

**Source:** Central Industrial Building fire sprinkler materials submittal (146 pages).
**Extraction inputs:** `docs/research/submittal-pages.json`, `docs/research/submittal-pages.txt`, and OCR of six scanned pages (`docs/research/scanned/page{39,109,130,131,132,143}.png`).
**Compiled:** 2026-06-05.

## Honesty / confidence notes (read first)

- Every model/series number below was found in the page-text extraction or read off a scanned page image. Nothing here is invented.
- Where a part is clearly present but its exact catalog/model number is **not** legible in the extraction, it is marked **(model not captured)**.
- The page-text detector tagged pages 137–138 with manufacturer "Globe." That is wrong: "Globe" there is the **valve body pattern** (globe vs. angle). The page footer is **Cla-Val** (Costa Mesa, CA). Corrected below.
- Manufacturers for the diesel fire-pump controller (Model GPD) and jockey-pump controller (Model JP3) are **not printed in the captured text** (marketing sheets only). The model naming (GPD / JP3) and styling match **Metron, Inc.** controllers, but the brand is not confirmed in the extraction — marked **(mfr uncertain)**.
- Pages 25–38, 83–84, 86–92 are largely font-garbled or image-only in the text layer; products there could not be reliably identified beyond what is noted.

---

## By category

### 1. Sprinkler heads

| Mfr | Product | Series / Style | Model numbers | Datasheet | Pages |
|---|---|---|---|---|---|
| Tyco (Johnson Controls) | Standard-response upright/pendent/recessed-pendent spray sprinklers | Series TY-B, Style 10 & Style 40, K2.8 / K5.6 / K8.0 | TY1151, TY1251, TY3151, TY3251, TY4151, TY4251, TY4851, TY4951 | TFP151 | 1–8 |
| Tyco (Johnson Controls) | Quick-response (fast-response) upright/pendent spray sprinklers | Series TY-FRB, Style 15 & Style 20 | TY313, TY323 | TFP172 | 9–12 |

> Note: TFP151 also references companion docs TFP700 (escutcheons), TFP770 (recessed/cover plate), TFP2300 (wrench) and Model S2 recessed escutcheon — accessories of the head line, not separate heads.

The user-stated roster also lists **Reliable** and **Viking** as head vendors. In **this** submittal, the spray heads are **Tyco**. Reliable appears only as the FDC vendor (see Devices). Viking does **not** appear in this submittal.

### 2. Valves / risers (preaction & fire-protection valves)

| Mfr | Product | Series | Sizes | Datasheet | Pages |
|---|---|---|---|---|---|
| Victaulic | FireLock NXT Preaction System (single- & double-interlocked, pneumatic / electric / autoconvert dry release) | Series 769N (preaction valve) | DN40–DN200 (1½"–8") | 31.82 | 13–24 |
| Victaulic | FireLock NXT actuation / supervisory valves & trim referenced in the 769N package | Series 776, 767, 798, 728, 705, 745, 746-LPA, 760, 75B, 75D, 755, 757, 757P, 7C7, 753E | — | 31.82 | 13–24 |
| Cla-Val | Fire-protection **Air Release Valve** | Series 34 (Model AR332, AR116) | per pipeline | E-34 Series | 133–136 |
| Cla-Val | Fire-protection **Pressure Relief Valve** (globe & angle body) | 50B-4KG1 (globe), 2050B-4KG1 (angle) | 3"–8" flanged/grooved | Cla-Val 2019 | 137–138 |

> The Series 769N is the heart of the riser. Series 776/767/798/728/705/745/769N/746-LPA/760/75B/75D/755 (plus 757/757P/7C7/753E) are the actuator, supervisory, check and trim valves listed across the FireLock NXT preaction datasheet. Individual size/trim selection is in the dimension tables (pp.17–22).

### 3. Couplings / fittings

| Mfr | Product | Series / No. | Notes | Datasheet | Pages |
|---|---|---|---|---|---|
| Victaulic | Installation-Ready rigid couplings | Style 009N (two-bolt), Style 109 (one-bolt) | DN32–DN300; ref. Style 009, 009V, No. 006, No. 60 gaskets | 10.64 | 71–81 |
| Victaulic | Grooved fittings — elbows | No. 10 (90°), No. 11 (45°), No. 12 (22½°), No. 13 (11¼°); No. 100/110 short-radius; No. W10/W11 | DN20–DN1500 | 07.01 | 45–70 |
| Victaulic | Grooved fittings — tees / crosses / wyes / laterals | No. 20 (tee), No. 25 / No. 29T (reducing tee), No. 30 / No. 30-R (lateral), No. 32 (tee-wye), No. 35, No. 33, No. 29M, No. 40 / 40-H / 4012, No. 42, No. 43 | — | 07.01 | 51–59 |
| Victaulic | Grooved fittings — base elbows / caps / plugs | No. R-10 / R-10G / R-10F (base elbow), No. 60 (cap), No. 61 (bull plug), No. 18, No. 19 | — | 07.01 | 50, 56, 60 |
| Victaulic | Grooved fittings — adapters / nipples / reducers | No. 41 / 45F / 45R / 46F / 46R / 45RE (flanged adapter nipple), No. 53 / 54 / 55 (swaged nipple), No. 80 / 48 (female threaded adapter), No. 50 (concentric reducer), No. 51 (eccentric reducer), No. 52 / 52F (small threaded reducer) | DN20–DN1500 | 07.01 | 61–68 |
| Victaulic | Branch outlet / mechanical-tee styles referenced | Style 177N, Style 741, Style 743, Style 72, Style 923, Style 924, Style 07 | — | 07.01 | 45, 56, 59, 69 |
| Tyco (Johnson Controls) | Ductile-iron NPT-threaded pipe fittings | Series 800 | NPT threaded | TFP1710 | 82 |

> Hanger components also appear (p.83 "100 Reversible Beam Clamp ¾″ mouth", p.84 "300 Ring Hanger") but the manufacturer/catalog brand is not captured in the text — likely a hanger vendor (e.g. AFCON/Tolco/Cooper B-Line class), **mfr not captured**.

### 4. Pipe

| Mfr | Product | Schedule / spec | Notes | Datasheet | Pages |
|---|---|---|---|---|---|
| Wheatland Tube | Fire Sprinkler Pipe | Schedule 10 & Schedule 40; ASTM A135 / A795 | ABFII-coated ID, UL/cUL listed; Sch.40 substitute (Norcom-branded sheet) | WFS-060520 | 41–44 |
| Bull Moose Tube | Sprinkler pipe (listed as approved specialty pipe on Victaulic coupling approval tables) | — | Co-listed with Wheatland on Victaulic Style 009N/109 specialty-pipe approval tables (ET40 etc.) | — | 78–80 |

> Wheatland is the primary pipe with its own submittal data sheet. Bull Moose appears as an **approved/co-listed** pipe brand on the Victaulic coupling approval pages, not as a standalone Bull Moose datasheet.

### 5. Fire pump package

| Mfr | Product | Model / Series | Detail | Pages |
|---|---|---|---|---|
| Patterson Pump Company (a Gorman-Rupp company) | Horizontal split-case fire pump package | Quote/job D02-68959; outline dwg D02-144228 | Pump package, outline dimensions, 360-gallon fuel tank (dwg D02-115505); refs FTA1100, FD120, UFAD58, UFAD88 | 95–100 |
| Patterson Pump Company | Suction & discharge **dial gauges** | C02-99432 | Suction gauge 0–30″ vac / 0–300 psi; discharge gauge 0–300 psi; ¼″ NPT (read from scanned p.143) | 143 |
| Clarke (Clarke Fire Protection Products) | Diesel engine fire-pump driver | Series JU4H / JU6H / JW6H / C18H0; engine JU6H-UFADT0; I&O C132909 Rev M | PLD discharge-pressure-limiting & PLD-S suction-pressure-limiting variants; -P1/-D/-S model suffixes; UF##-P1 family (UF10/12/20/22/30/32/40/42/50/52/60/62-P1) | 101–108 |
| EM Products (EM Products, Inc.) | Engine **exhaust silencer** | Model JI Series — Industrial Grade (12–18 dBA) | End-inlet/end-outlet JIE-## and side-inlet/end-outlet JIS-## sizes; ²″–3½″ NPT, larger 125#/150# ANSI flanged (read from scanned p.109) | 109 |
| (mfr uncertain — Metron-style) | Diesel engine driven **fire pump controller** | Model GPD | UL218; NFPA 20 (2016); IP31/54/55/65/66; drawings DI700, WS700, LY700, TD700/701, FL001; wiring J103–J107 | 110–122 |
| (mfr uncertain — Metron-style) | **Jockey pump controller** (across-the-line start) | Model JP3 | UL508A; NEMA 2 enclosure; ⅛″ NPT conduit; dwg JP3-D500/E (read from scanned p.130) | 125–130 |
| Cla-Val | Fire-pump **flow meter** (flow test / e-flowmeter) | Model GT-FluxFP | GT-FluxFP-SV-Rev0-E (Dec 2019) | 139–142 |
| Cla-Val | **Waste cone** (flow-test discharge cone) | Model WC-1 | 150# FF / 300# RF flanges; ductile iron A536-65 | 144 |

> Pumphouse / flow-test train (air release valve, pressure relief valve, flow meter, waste cone, dial gauges) is the Cla-Val + Patterson portion. The diesel engine is **Clarke**; the exhaust silencer is **EM Products**; the two controllers are **Model GPD** (main) and **Model JP3** (jockey), brand not printed in the captured marketing sheets.

### 6. Devices / accessories

| Mfr | Product | Model / Series | Detail | Pages |
|---|---|---|---|---|
| Potter (Potter Electric Signal Company) | IntelliGen™ **Nitrogen Generators** (corrosion control) | "Model Number" table — specific model strings not captured in text layer | Distributed via Ferguson Fire & Fabrication | 93–94 |
| Reliable (Reliable Automatic Sprinkler) | **Fire Department Connection (FDC)** | model not captured (4″ IPS nipple install instructions only) | Installs with PipeFit® sealant; identification sign on nipple | 85 |
| FPPI (Fire Protection Products, Inc.) | **Spare Sprinkler Head Storage Cabinet** | Painted-steel red cabinet, multiple capacities | 3 / 6 / 12 / 24 / 36 spare-head sizes; standard/ESFR styles (read from scanned p.39) | 39 |

> Potter appears twice: (a) as the **nitrogen generator** vendor (pp.93–94), and (b) referenced as a compatible release-panel option ("Potter 4410RC panel") inside the Victaulic 769N autoconvert requirements (p.23) — that panel is a reference, not a submitted Potter line item.

---

## Vendor roster — stated vs. present in THIS submittal

User-stated general vendor roster: **Victaulic, Argco, Potter-Roemer, Watts, Reliable, Viking, Wheatland, Bull Moose.**

| Vendor (stated) | In this submittal? | Where / note |
|---|---|---|
| Victaulic | **Yes** | Preaction valves, couplings, full grooved fitting line (pp.13–24, 45–81) |
| Wheatland | **Yes** | Sprinkler pipe Sch.10/40 (pp.41–44) |
| Bull Moose | **Yes (co-listed)** | Approved specialty pipe on Victaulic coupling tables (pp.78–80) |
| Reliable | **Yes** | Fire Department Connection (p.85) — heads here are Tyco, not Reliable |
| Potter-Roemer | **No (distinct from Potter)** | "Potter" present = Potter Electric (nitrogen generators), **not** Potter-Roemer. Potter-Roemer does not appear |
| Argco | **No** | General vendor only; not in this submittal |
| Watts | **No** | General vendor only; not in this submittal |
| Viking | **No** | General vendor only; not in this submittal |

Manufacturers present in this submittal **beyond** the stated roster: **Tyco / Johnson Controls** (heads + fittings), **Cla-Val** (air release / relief valve / flow meter / waste cone), **Patterson Pump** (fire pump + gauges), **Clarke** (diesel engine), **EM Products** (exhaust silencer), **FPPI** (spare-head cabinet), plus the unbranded **Model GPD / Model JP3** pump controllers (Metron-style).

---

## Distinct models listed (partCount basis)

Tyco heads: TY1151, TY1251, TY3151, TY3251, TY4151, TY4251, TY4851, TY4951, TY313, TY323 (10) ·
Victaulic valves: 769N, 776, 767, 798, 728, 705, 745, 746-LPA, 760, 75B, 75D, 755, 757, 757P, 7C7, 753E (16) ·
Victaulic couplings/styles: 009N, 109 (2) ·
Victaulic fittings (No.): 10, 11, 12, 13, 100, 110, 20, 25, 29T, 30, 30-R, 32, 35, 33, 29M, 40, 42, 43, R-10, 60, 61, 41, 45F, 45R, 46F, 46R, 45RE, 53, 54, 55, 80, 48, 50, 51, 52, 52F (36) ·
Tyco fittings: Series 800 (1) ·
Pipe: Wheatland Sch.10/40 (1), Bull Moose (1) ·
Fire pump package: Patterson pump pkg (1), Patterson dial gauges C02-99432 (1), Clarke JU6H/diesel driver (1), EM Products JI silencer (1), Model GPD controller (1), Model JP3 jockey controller (1), Cla-Val GT-FluxFP flow meter (1), Cla-Val WC-1 waste cone (1) ·
Valves (Cla-Val): Series 34 air release (1), 50B-4KG1/2050B-4KG1 relief (1) ·
Devices: Potter IntelliGen nitrogen generator (1), Reliable FDC (1), FPPI spare-head cabinet (1).

**Distinct models / line items listed: 80.**

(10 Tyco heads + 16 Victaulic valves + 2 Victaulic couplings + 36 Victaulic fittings + 1 Tyco Series 800 + 2 pipe + 8 fire-pump-package items + 2 Cla-Val valves + 3 devices = 80.)
