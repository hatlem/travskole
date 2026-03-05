# Logo og Visuell Identitet

## 🎨 Nåværende Logo (Placeholder)

**Kilde:** Bjerke Travbane (bjerke.no)

Vi bruker for øyeblikket Bjerkebanen sin offisielle logo som placeholder for Travskole-prosjektet:

- `bjerkebanen-logo-blaa.png` - Blå logo (for lyse bakgrunner)
- `bjerkebanen-logo-invertert.png` - Hvit logo (for mørke bakgrunner)

**Hvor brukes det:**
- Header (`components/Header.tsx`) - bruker invertert (hvit) versjon

## ⚠️ Dette er en midlertidig løsning

Travskolen bør få sin **egen visuell identitet** før lansering:

### Hva trengs:
1. **Egen logo** for "Bjerke Travskole"
   - Bør matche Bjerkes fargepalett (#003B7A blå, #F5F5F5 grå)
   - Men ha sin egen identitet
   
2. **Format:**
   - SVG (foretrukket for skalerbarhet)
   - PNG med transparent bakgrunn
   - Minst 2x varianter: Fullfarget + invertert/hvit
   - Anbefalt størrelse: 600px bredde minimum

3. **Fil-navngiving:**
   - `travskole-logo.svg`
   - `travskole-logo.png`
   - `travskole-logo-white.svg`
   - `travskole-logo-white.png`

## 🔄 Slik bytter du logo:

1. Legg nye logo-filer i `/public/` mappen
2. Oppdater `components/Header.tsx`:
   ```tsx
   <Image 
     src="/travskole-logo-white.svg" 
     alt="Bjerke Travskole" 
     width={180} 
     height={50}
     // ...
   />
   ```
3. Fjern `<span>Travskole</span>` hvis ny logo inkluderer tekst
4. Oppdater `favicon.ico` og app icons i `/public/`

## 📝 Notater

- Placeholder-logo hentet fra bjerke.no: `/contentassets/32b6379a83824a868d304cf6dc12ed42/`
- Datum lagt til: 2026-03-05
- Av: Moltbot (OpenClaw AI)
