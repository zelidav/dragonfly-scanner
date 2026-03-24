import { useState, useEffect, useRef, useCallback } from âreactâ;

// âââ Levenshtein edit distance âââââââââââââââââââââââââââââââââââââââââââââ
const editDistance = (a, b) => {
if (a.length === 0) return b.length;
if (b.length === 0) return a.length;
const matrix = [];
for (let i = 0; i <= b.length; i++) matrix[i] = [i];
for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
for (let i = 1; i <= b.length; i++) {
for (let j = 1; j <= a.length; j++) {
matrix[i][j] = b[i - 1] === a[j - 1]
? matrix[i - 1][j - 1]
: Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
}
}
return matrix[b.length][a.length];
};

// âââ Common OCR misreads for cannabis label text âââââââââââââââââââââââââââ
const ocrNormalize = (text) => {
return text
.toLowerCase()
.replace(/[^a-z0-9\s#]/g, â â)
.replace(/0/g, âoâ)       // 0 â o
.replace(/1(?=[a-z])/g, âlâ) // 1 before letter â l
.replace(/5(?=[a-z])/g, âsâ) // 5 before letter â s
.replace(/8/g, âbâ)       // 8 â b (common on stylized fonts)
.replace(/\s+/g, â â)
.trim();
};

// âââ Fuzzy strain matcher â multi-strategy âââââââââââââââââââââââââââââââââ
const fuzzyMatch = (ocrText, strainNames) => {
if (!ocrText || ocrText.trim().length < 3) return null;

// Clean and normalize OCR text
const raw = ocrText.toLowerCase().replace(/[^a-z0-9\s#-â]/g, â â).replace(/\s+/g, â â).trim();
const normalized = ocrNormalize(ocrText);
const lines = ocrText.split(/\n/).map(l => l.trim().toLowerCase()).filter(l => l.length > 2);
const allWords = raw.split(/\s+/).filter(w => w.length >= 2);

console.log(âOCR cleaned:â, raw);
console.log(âOCR lines:â, lines);

let bestMatch = null;
let bestScore = 0;

for (const name of strainNames) {
const nameLower = name.toLowerCase();
const nameNorm = ocrNormalize(name);
const nameWords = nameLower.split(/\s+/);
let score = 0;

```
// ââ Strategy 1: Exact substring match in raw text (highest confidence)
if (raw.includes(nameLower)) { return name; }
if (normalized.includes(nameNorm)) { score += 20; }

// ââ Strategy 2: Check each line individually (labels often have strain name on its own line)
for (const line of lines) {
  if (line.includes(nameLower)) return name;
  const lineNorm = ocrNormalize(line);
  if (lineNorm.includes(nameNorm)) { score += 15; break; }
  // Edit distance on full line vs strain name
  if (line.length < nameLower.length * 2) {
    const dist = editDistance(line.replace(/\s/g, ""), nameLower.replace(/\s/g, ""));
    if (dist <= 2) { score += 12; break; }
    if (dist <= 3 && nameLower.length >= 6) { score += 8; break; }
  }
}

// ââ Strategy 3: Word-level matching
let wordHits = 0;
for (const nw of nameWords) {
  // Direct word match
  if (allWords.includes(nw)) { wordHits++; score += 5; continue; }
  // Check each OCR word for close edit distance
  for (const ow of allWords) {
    if (ow.length < 3) continue;
    const dist = editDistance(nw, ow);
    const maxDist = nw.length <= 4 ? 1 : 2;
    if (dist <= maxDist) { wordHits++; score += 4 - dist; break; }
    // Substring containment (OCR might merge/split words)
    if (nw.length >= 4 && (ow.includes(nw) || nw.includes(ow))) { wordHits++; score += 3; break; }
  }
}

// Bonus if all words of the strain name were found
if (wordHits === nameWords.length) score += 6;
// Bonus for single-word strains that match closely
if (nameWords.length === 1 && nameLower.length >= 4) {
  for (const ow of allWords) {
    if (editDistance(nameLower, ow) <= 1) { score += 10; break; }
  }
}

// ââ Strategy 4: Check for "dragonfly" nearby (increases confidence this is a Dragonfly product)
if (raw.includes("dragonfly") || raw.includes("dragon") || normalized.includes("dragonfly")) {
  score += 2;
}

if (score > bestScore) {
  bestScore = score;
  bestMatch = name;
}
```

}

console.log(âBest match:â, bestMatch, âscore:â, bestScore);

// Only return if confidence is high enough
return bestScore >= 5 ? bestMatch : null;
};

// âââ Dragonfly Strain Database âââââââââââââââââââââââââââââââââââââââââââââ
const STRAIN_DB = {
// Prerolls
âHoney Bananaâ: { type: âHybridâ, thc: â24-28%â, genetics: âHoney Boo Boo Ã Banana OGâ, lineage: âGranddaddy Purple Ã Bukake â Honey Boo Boo | Banana Kush Ã OG Kush â Banana OGâ, flavor: âSweet honey, ripe banana, tropical fruitâ, effects: âEuphoric, relaxed, creativeâ, terpenes: âMyrcene, Limonene, Caryophylleneâ, description: âA smooth hybrid that wraps you in sweetness. The Honey Boo Boo parentage brings deep relaxation while Banana OG adds uplifting euphoria.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Honey-Banana.webpâ },
âIce Cream Cookiesâ: { type: âIndicaâ, thc: â26-30%â, genetics: âIce Cream Cake Ã Girl Scout Cookiesâ, lineage: âGelato 33 Ã Wedding Cake â Ice Cream Cake | OG Kush Ã Durban Poison â GSCâ, flavor: âCreamy vanilla, sweet dough, earthyâ, effects: âSedating, happy, relaxedâ, terpenes: âLimonene, Caryophyllene, Linaloolâ, description: âA dessert-forward indica that hits like a warm blanket. The Gelato lineage brings creamy smoothness while GSC genetics deliver the punch.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Ice-Cream-Cookies.webpâ },
âJelly Donutzâ: { type: âIndicaâ, thc: â25-29%â, genetics: âJelly Breath Ã Dosidosâ, lineage: âMendo Breath Ã Do-Si-Dos â Jelly Breath | Face Off OG Ã OGKB â Dosidosâ, flavor: âSweet berry jam, doughy, sugar glazeâ, effects: âRelaxed, sleepy, euphoricâ, terpenes: âLinalool, Myrcene, Limoneneâ, description: âNamed for its impossibly sweet, pastry-like flavor. The Mendo Breath genetics bring heavy body relaxation and a sweet, jammy exhale.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Jelly-Donutz.webpâ },
âOrange Creampopâ: { type: âHybridâ, thc: â22-26%â, genetics: âOrange Cookies Ã Cookies & Creamâ, lineage: âOrange Juice Ã GSC â Orange Cookies | Starfighter Ã GSC â Cookies & Creamâ, flavor: âCitrus burst, vanilla cream, sweet orangeâ, effects: âUplifting, creative, relaxedâ, terpenes: âLimonene, Myrcene, Humuleneâ, description: âLike biting into a frozen creamsicle on a summer day. The Orange Cookies parentage delivers bright citrus while the Cookies & Cream adds a creamy finish.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Orange-Creampop.webpâ },
âSkittlezâ: { type: âIndicaâ, thc: â24-28%â, genetics: âZkittlez (Grape Ape Ã Grapefruit)â, lineage: âMendocino Purps Ã Afghani â Grape Ape | Grapefruit (Cinderella 99 pheno)â, flavor: âTropical fruit medley, grape, berryâ, effects: âCalming, euphoric, focusedâ, terpenes: âCaryophyllene, Linalool, Humuleneâ, description: âThe legendary Zkittlez delivers a rainbow of fruit flavors. Grape Ape brings the purple color and calm, while Grapefruit genetics add citrusy uplift.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Skittlez.webpâ },
âTriple Cakeâ: { type: âHybridâ, thc: â26-30%â, genetics: âTriangle Mints Ã Wedding Cakeâ, lineage: âTriangle Kush Ã Animal Mints â Triangle Mints | Cherry Pie Ã GSC â Wedding Cakeâ, flavor: âSweet cake batter, mint, gasâ, effects: âEuphoric, relaxed, creativeâ, terpenes: âLimonene, Caryophyllene, Myrceneâ, description: âTriple the cake, triple the hit. Triangle Mints brings minty gas while Wedding Cake adds layers of sweet, doughy flavor with potent effects.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Triple-Cake.webpâ },
âAfghan Kushâ: { type: âIndicaâ, thc: â20-25%â, genetics: âLandrace (Hindu Kush Mountains, Afghanistan)â, lineage: âPure landrace indica â one of cannabisâ oldest cultivated strains, originating from the mountainous border of Afghanistan and Pakistanâ, flavor: âEarthy, woody, sweet hashâ, effects: âDeeply relaxing, sedating, stress reliefâ, terpenes: âMyrcene, Pinene, Caryophylleneâ, description: âA pure landrace strain from the Hindu Kush mountain range. Thousands of years of natural selection created this bulletproof indica â the genetic backbone of countless modern hybrids.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Afghan-Kush.webpâ },
âAK-47â: { type: âSativaâ, thc: â20-25%â, genetics: âColombian Ã Mexican Ã Thai Ã Afghanâ, lineage: âA complex sativa-dominant blend of South American, Mexican, Thai, and Afghani landraces â first crossed in 1992 by Serious Seeds in the Netherlandsâ, flavor: âEarthy, floral, sweet, sourâ, effects: âUplifting, creative, alert, socialâ, terpenes: âMyrcene, Pinene, Caryophylleneâ, description: âDespite its intense name, AK-47 delivers a mellow, steady cerebral buzz. Four landrace genetics combine to create one of the most awarded strains in cannabis history.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-AK-47.webpâ },
âBlue Dreamâ: { type: âSativaâ, thc: â21-26%â, genetics: âBlueberry Ã Hazeâ, lineage: âAfghani Ã Thai Ã Purple Thai â Blueberry | Colombian Gold Ã Thai Ã Mexican Ã South Indian â Hazeâ, flavor: âSweet blueberry, vanilla, herbalâ, effects: âBalanced euphoria, gentle relaxation, creativeâ, terpenes: âMyrcene, Pinene, Caryophylleneâ, description: âCaliforniaâs most iconic strain. The legendary DJ Short Blueberry brings sweet berry flavor while Haze genetics deliver soaring, clear-headed energy. The perfect balance.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Blue-Dream.webpâ },
âCap Junkyâ: { type: âHybridâ, thc: â28-33%â, genetics: âAlien Cookies Ã Kush Mints #11â, lineage: âGSC Ã Alien Dawg â Alien Cookies | Bubba Kush Ã Animal Mints â Kush Mintsâ, flavor: âMinty gas, earthy funk, sweet creamâ, effects: âPotent euphoria, creative, relaxedâ, terpenes: âLimonene, Caryophyllene, Myrceneâ, description: âA top-shelf powerhouse crossing two cookie-family heavyweights. Alien Cookies brings the funk while Kush Mints adds a frosty, gassy edge. Extremely high THC.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Cap-Junky.webpâ },
âChernobylâ: { type: âHybridâ, thc: â22-26%â, genetics: âTrainwreck Ã Jack the Ripperâ, lineage: âMexican Ã Thai Ã Afghani â Trainwreck | Jackâs Cleaner Ã Space Queen â Jack the Ripperâ, flavor: âLime sherbet, tropical citrus, sweetâ, effects: âEnergetic, uplifting, gigglyâ, terpenes: âTerpinolene, Myrcene, Ocimeneâ, description: âCreated by TGA Subcool, Chernobyl is famous for its nuclear-green buds and radioactive lime flavor. Trainwreck provides the energy while Jack the Ripper adds a sweet citrus kick.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Chernobyl.webpâ },
âCookie Crushâ: { type: âHybridâ, thc: â25-29%â, genetics: âGSC Ã OG Kushâ, lineage: âDurban Poison Ã OG Kush â GSC | Chemdawg Ã Hindu Kush â OG Kushâ, flavor: âSweet cookies, earthy pine, vanillaâ, effects: âEuphoric, relaxed, happyâ, terpenes: âCaryophyllene, Limonene, Humuleneâ, description: âA double dose of the Cookie familyâs best traits. Girl Scout Cookies brings the sweet, doughy flavor while OG Kush reinforces the potent, relaxing backbone.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Cookie-Crush.webpâ },
âDeath Starâ: { type: âIndicaâ, thc: â24-28%â, genetics: âSensi Star Ã Sour Dieselâ, lineage: âAfghani indica hybrid â Sensi Star | Chemdawg Ã Mass Super Skunk Ã Northern Lights â Sour Dieselâ, flavor: âDiesel fuel, earthy, sweet skunkâ, effects: âHeavy relaxation, euphoric, sleepyâ, terpenes: âMyrcene, Caryophyllene, Limoneneâ, description: âNamed for its ability to destroy stress. Sensi Star brings the indica weight while Sour Diesel adds a sativa-leaning cerebral sparkle and pungent fuel aroma.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Death-Star.webpâ },
âGarlic Budderâ: { type: âIndicaâ, thc: â26-30%â, genetics: âGMO Ã Peanut Butter Breathâ, lineage: âChemdawg Ã GSC â GMO (Garlic Mushroom Onion) | Do-Si-Dos Ã Mendo Breath â Peanut Butter Breathâ, flavor: âGarlic, savory, creamy, funkyâ, effects: âHeavy body, relaxed, sedatingâ, terpenes: âCaryophyllene, Myrcene, Limoneneâ, description: âFor the savory palate â GMOâs unmistakable garlic funk meets the creamy, nutty smoothness of Peanut Butter Breath. One of the most unique flavor profiles in the game.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Garlic-Budder.webpâ },
âGG#4â: { type: âHybridâ, thc: â25-30%â, genetics: âChemâs Sister Ã Sour Dubb Ã Chocolate Dieselâ, lineage: âChemdawg sibling â Chemâs Sister | Sour Diesel phenotype â Sour Dubb | Sour Diesel Ã Chocolate Trip â Chocolate Dieselâ, flavor: âPine, earthy chocolate, dieselâ, effects: âGlued-to-couch, euphoric, relaxedâ, terpenes: âCaryophyllene, Myrcene, Limoneneâ, description: âThe legendary GG#4 (Gorilla Glue) â an accidental cross that became one of cannabisâ most celebrated strains. Named for the resin that sticks to everything during trimming.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-GG4.webpâ },
âGreen Crackâ: { type: âSativaâ, thc: â20-25%â, genetics: âSkunk #1 Ã Unknown Indica (disputed Afghani)â, lineage: âOriginally named âCushâ â renamed by Snoop Dogg for its energizing effects. Descended from Skunk #1 lineage with possible Sweet Leaf/Afghani geneticsâ, flavor: âCitrus mango, tropical, sweetâ, effects: âEnergetic, focused, upliftingâ, terpenes: âMyrcene, Pinene, Caryophylleneâ, description: âThe ultimate wake-and-bake strain. Delivers a tangy, fruity flavor and sharp mental energy. Snoop renamed it for the intense, invigorating rush it delivers.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Green-Crack.webpâ },
âHeadbandâ: { type: âHybridâ, thc: â24-28%â, genetics: âOG Kush Ã Sour Dieselâ, lineage: âChemdawg Ã Hindu Kush â OG Kush | Chemdawg Ã Mass Super Skunk Ã Northern Lights â Sour Dieselâ, flavor: âCreamy lemon, diesel, earthyâ, effects: âCerebral pressure, relaxed, euphoricâ, terpenes: âMyrcene, Limonene, Caryophylleneâ, description: âNamed for the subtle pressure you feel around your temples â like wearing an invisible headband. Two of cannabisâ greatest strains combine for smooth, long-lasting effects.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Headband.webpâ },
âJealousyâ: { type: âHybridâ, thc: â27-31%â, genetics: âGelato 41 Ã Sherbertâ, lineage: âSunset Sherbet Ã Thin Mint GSC â Gelato 41 | GSC Ã Pink Panties â Sherbertâ, flavor: âCreamy gelato, candy, berryâ, effects: âBalanced, euphoric, creative, calmâ, terpenes: âCaryophyllene, Limonene, Linaloolâ, description: âBred by Seed Junky Genetics, Jealousy lives up to the hype. Dense, purple-tinted buds deliver a creamy, candy-like flavor and perfectly balanced effects.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Jealousy.webpâ },
âJet Fuel Gelatoâ: { type: âHybridâ, thc: â27-32%â, genetics: âJet Fuel Ã Gelatoâ, lineage: âAspen OG Ã High Country Diesel â Jet Fuel | Sunset Sherbet Ã Thin Mint GSC â Gelatoâ, flavor: âGas, sweet cream, diesel, berryâ, effects: âPotent euphoria, energetic, relaxedâ, terpenes: âCaryophyllene, Limonene, Myrceneâ, description: âHigh-octane meets creamy dessert. Jet Fuel brings the gas-forward punch while Gelato smooths it out with sweet, creamy undertones. A premium hybrid experience.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Jet-Fuel-Gelato.webpâ },
âKush Mintzâ: { type: âHybridâ, thc: â27-32%â, genetics: âAnimal Mints Ã Bubba Kushâ, lineage: âThin Mint GSC Ã Fire OG Ã Animal Cookies â Animal Mints | OG Kush Ã Afghani â Bubba Kushâ, flavor: âMinty, earthy, sweet, coffeeâ, effects: âRelaxing, euphoric, calmingâ, terpenes: âLimonene, Caryophyllene, Myrceneâ, description: âSeed Junkyâs masterpiece. The Animal Mints gives it that frosty mint flavor while Bubba Kush adds old-school body sedation. A modern classic with legendary parents.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Kush-Mintz.webpâ },
âLemon Pound Cakeâ: { type: âHybridâ, thc: â23-27%â, genetics: âLemon Skunk Ã Cheeseâ, lineage: âLemon Joy Ã Skunk #1 â Lemon Skunk | Skunk #1 phenotype â Cheeseâ, flavor: âLemon zest, buttery cake, sweet creamâ, effects: âUplifting, social, relaxedâ, terpenes: âLimonene, Caryophyllene, Humuleneâ, description: âExactly what it sounds like â a rich, buttery lemon cake flavor that coats the palate. The Lemon Skunk parentage provides zesty brightness while Cheese adds depth and body.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Lemon-Pound-Cake.webpâ },
âLiberty Hazeâ: { type: âSativaâ, thc: â22-27%â, genetics: âG13 Ã ChemDawg 91â, lineage: âGovernment G13 (legendary Afghani indica) Ã ChemDawg 91 (Chemdawg phenotype) â bred by Barneyâs Farm, 2011 Cannabis Cup winnerâ, flavor: âSharp lime, earthy, chemical, sweetâ, effects: âEnergetic, creative, cerebralâ, terpenes: âTerpinolene, Myrcene, Pineneâ, description: âA Cannabis Cup champion from Barneyâs Farm. The mythical G13 brings potency while ChemDawg 91 adds electric sativa energy. Named for the freedom it gives your mind.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Liberty-Haze.webpâ },
âNorthern Lightsâ: { type: âIndicaâ, thc: â20-24%â, genetics: âAfghani Ã Thaiâ, lineage: âPure Afghani indica landrace Ã Thai sativa landrace â originally cultivated in Seattle, perfected by Sensi Seeds in the Netherlands in the 1980sâ, flavor: âSweet earth, pine, honeyâ, effects: âFull body relaxation, dreamy, sleepyâ, terpenes: âMyrcene, Pinene, Caryophylleneâ, description: âOne of the most famous indicas ever created. Northern Lights has been a cornerstone of cannabis breeding since the 1980s â a two-time Cannabis Cup winner and parent to countless hybrids.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Northern-Lights.webpâ },
âNYC Dieselâ: { type: âHybridâ, thc: â21-25%â, genetics: âMexican Sativa Ã Afghaniâ, lineage: âSoma Seeds creation â Mexican sativa landrace Ã Afghani indica with possible Sour Diesel influence. A New York City staple since the early 2000sâ, flavor: âGrapefruit diesel, lime, red berryâ, effects: âCerebral, talkative, creative, happyâ, terpenes: âLimonene, Myrcene, Caryophylleneâ, description: âBorn in the Big Apple. NYC Diesel captures the electric energy of the city in a joint â bright citrus and diesel fuel aroma with a creative, social buzz that keeps the conversation flowing.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-NYC-Diesel.webpâ },
âNYC Kushâ: { type: âIndicaâ, thc: â28-32%â, genetics: âNYC Diesel Ã OG Kushâ, lineage: âNYC Diesel (Mexican Sativa Ã Afghani) Ã OG Kush (Chemdawg Ã Hindu Kush) â a potent cross blending NYCâs signature diesel funk with the legendary OG Kush backboneâ, flavor: âDiesel, earthy pine, sweet citrus, spiceâ, effects: âHeavy relaxation, euphoric, cerebral, stress reliefâ, terpenes: âMyrcene, Limonene, Caryophylleneâ, description: âThe best of both coasts collide. NYC Dieselâs electric cerebral energy meets OG Kushâs legendary body-melting potency. A powerhouse indica-leaning hybrid that hits hard at 30%+ THC â true New York muscle.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-NYC-Kush.webpâ },
âSkywalker OGâ: { type: âIndicaâ, thc: â25-30%â, genetics: âSkywalker Ã OG Kushâ, lineage: âBlueberry Ã Mazar I Sharif â Skywalker | Chemdawg Ã Hindu Kush â OG Kushâ, flavor: âEarthy pine, spicy, herbalâ, effects: âHeavy sedation, euphoric, tranquilâ, terpenes: âMyrcene, Caryophyllene, Limoneneâ, description: âThe force is strong with this one. Skywalkerâs Blueberry-Afghan heritage meets the unmatched potency of OG Kush for a deeply sedating experience that sends you to a galaxy far, far away.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Skywalker-OG.webpâ },
âSour Lemonsâ: { type: âSativaâ, thc: â22-26%â, genetics: âSour Diesel Ã Lemon OGâ, lineage: âChemdawg Ã Mass Super Skunk Ã NL â Sour Diesel | Lemon Skunk Ã OG Kush â Lemon OGâ, flavor: âSharp lemon, sour diesel, citrus peelâ, effects: âEnergetic, focused, mood-boostingâ, terpenes: âLimonene, Pinene, Caryophylleneâ, description: âA citrus explosion that hits you right between the eyes. Sour Dieselâs legendary energy gets a lemon-forward twist from Lemon OG. Perfect for daytime productivity.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Sour-Lemons.webpâ },
âSpace Candyâ: { type: âSativaâ, thc: â20-24%â, genetics: âSpace Queen Ã Cotton Candyâ, lineage: âRomulan Ã Cinderella 99 â Space Queen | Lavender Ã Power Plant â Cotton Candyâ, flavor: âSweet candy, floral, tropical citrusâ, effects: âEnergetic, creative, happyâ, terpenes: âMyrcene, Terpinolene, Ocimeneâ, description: âA whimsical sativa that tastes like a candy shop in outer space. Space Queen brings the cosmic energy while Cotton Candy adds layers of sweetness and floral complexity.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Space-Candy.webpâ },
âTrainwreckâ: { type: âSativaâ, thc: â22-27%â, genetics: âMexican Ã Thai Ã Afghaniâ, lineage: âMexican sativa Ã Thai sativa Ã Afghani indica â originated in Northern Californiaâs Emerald Triangle, named for its intense, fast-hitting effectsâ, flavor: âSpicy pine, lemon, earthy pepperâ, effects: âFast-hitting euphoria, creative, energeticâ, terpenes: âTerpinolene, Myrcene, Pineneâ, description: âA legendary NorCal strain that hits you like its name suggests. Three landrace genetics combine for a spicy, pine-forward sativa that delivers immediate cerebral stimulation.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Trainwreck.webpâ },
âWedding Cakeâ: { type: âHybridâ, thc: â25-30%â, genetics: âCherry Pie Ã Girl Scout Cookiesâ, lineage: âGranddaddy Purple Ã Durban Poison â Cherry Pie | OG Kush Ã Durban Poison â GSCâ, flavor: âSweet vanilla frosting, tangy, earthyâ, effects: âRelaxed, euphoric, happyâ, terpenes: âLimonene, Caryophyllene, Myrceneâ, description: âAlso known as Pink Cookies â a powerhouse that tastes like a slice of wedding cake. Cherry Pie brings fruity sweetness while GSC adds the beloved cookie dough flavor and balanced effects.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Wedding-Cake.webpâ },
âWhite Fire OGâ: { type: âHybridâ, thc: â25-29%â, genetics: âFire OG Ã The Whiteâ, lineage: âOG Kush Ã SFV OG â Fire OG | Unknown triangle cross â The White (famous for trichome production)â, flavor: âEarthy, woody, pepper, dieselâ, effects: âUplifting, relaxed, focusedâ, terpenes: âCaryophyllene, Limonene, Myrceneâ, description: âWiFi OG â where Fire OGâs intense potency meets The Whiteâs legendary frost. Known for snowcapped buds and a clean, peppery diesel flavor that cannabis connoisseurs chase.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-White-Fire-OG.webpâ },
âZoapâ: { type: âHybridâ, thc: â26-30%â, genetics: âRainbow Sherbet Ã Pink Guavaâ, lineage: âChampagne Ã Blackberry â Rainbow Sherbet | Unknown exotic cross â Pink Guava (Deep East Oakland genetics by Deo Farms)â, flavor: âSoapy floral, fruity, sweet, berryâ, effects: âBalanced euphoria, creative, relaxedâ, terpenes: âCaryophyllene, Limonene, Linaloolâ, description: âBred by DEO Farms, Zoap took the cannabis world by storm. Its unique soapy-floral-fruit flavor is unlike anything else. Rainbow Sherbet brings color while Pink Guava adds exotic sweetness.â, category: âPreroll 1gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/PRE-Zoap.webpâ },
// Infused Prerolls
âBanana Bashâ: { type: âHybridâ, thc: â35-40%+â, genetics: âBanana Kush Ã Hindu Kush (Infused)â, lineage: âGhost OG Ã Skunk Haze â Banana Kush | Hindu Kush landrace â enhanced with live resin concentrate for amplified potencyâ, flavor: âBanana cream, sweet tropical, earthy hashâ, effects: âPowerful euphoria, deeply relaxed, blissfulâ, terpenes: âMyrcene, Limonene, Caryophylleneâ, description: âAn infused powerhouse. The Banana Kush base delivers sweet tropical flavor, amplified with concentrate for an elevated experience. Not for beginners.â, category: âInfused Preroll 1.25gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/INF-Banana-Bash.jpgâ },
âBlueberry Banana Wafflesâ: { type: âIndicaâ, thc: â35-40%+â, genetics: âBlueberry Ã Banana OG (Infused)â, lineage: âDJ Shortâs Blueberry (Afghani Ã Thai Ã Purple Thai) Ã Banana OG â infused with premium concentrateâ, flavor: âBlueberry pancakes, banana bread, mapleâ, effects: âSedating, euphoric, munchiesâ, terpenes: âMyrcene, Limonene, Linaloolâ, description: âBreakfast in a joint. DJ Shortâs legendary Blueberry meets Banana OG, then gets infused for maximum impact. The flavor literally tastes like blueberry banana waffles.â, category: âInfused Preroll 1.25gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/INF-Blueberry-Banana-Waffles.jpgâ },
âJust Peachyâ: { type: âHybridâ, thc: â35-40%+â, genetics: âGeorgia Pie Ã Peach Ringz (Infused)â, lineage: âGelatti Ã Kush Mints â Georgia Pie | Unknown exotic cross â Peach Ringz â enhanced with live resinâ, flavor: âFresh peach, candy rings, sweet creamâ, effects: âUplifting, euphoric, relaxedâ, terpenes: âLimonene, Myrcene, Caryophylleneâ, description: âGeorgia Pieâs candy-forward genetics meet Peach Ringz for a fruity experience that tastes exactly like the candy. Infusion pushes potency into the stratosphere.â, category: âInfused Preroll 1.25gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/INF-Just-Peachy.jpgâ },
âLychee Dreamâ: { type: âSativaâ, thc: â35-40%+â, genetics: âLychee Ã Dream (Infused)â, lineage: âExotic lychee-flavored cultivar crossed with dreamy sativa genetics â infused with premium concentrate for enhanced potencyâ, flavor: âSweet lychee fruit, floral, tropicalâ, effects: âCreative, uplifting, dreamy euphoriaâ, terpenes: âTerpinolene, Myrcene, Ocimeneâ, description: âAn exotic sativa-leaning infused preroll that captures the unmistakable sweetness of fresh lychee fruit. The infusion adds layers of potency while maintaining the delicate flavor profile.â, category: âInfused Preroll 1.25gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/INF-Lychee-Dream.jpgâ },
âStrawberry Kiwiâ: { type: âHybridâ, thc: â35-40%+â, genetics: âStrawberry Cough Ã Kiwi Kush (Infused)â, lineage: âStrawberry Fields Ã Haze â Strawberry Cough | Kiwi-flavored OG phenotype â Kiwi Kush â infused with concentrateâ, flavor: âFresh strawberry, kiwi tang, sweet berryâ, effects: âHappy, social, relaxedâ, terpenes: âMyrcene, Limonene, Pineneâ, description: âThe classic juice box flavor in an infused joint. Strawberry Coughâs legendary berry flavor gets a tropical twist from Kiwi Kush, then concentrated infusion takes it next level.â, category: âInfused Preroll 1.25gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/INF-Strawberry-Kiwi.jpgâ },
âWatermelon Skittlezâ: { type: âIndicaâ, thc: â35-40%+â, genetics: âWatermelon Zkittlez Ã Zkittlez (Infused)â, lineage: âWatermelon phenotype Ã Zkittlez (Grape Ape Ã Grapefruit) â infused with premium live resin concentrateâ, flavor: âJuicy watermelon, candy, tropical fruitâ, effects: âDeeply relaxing, euphoric, sleepyâ, terpenes: âMyrcene, Caryophyllene, Limoneneâ, description: âSummer in an infused preroll. The Watermelon phenotype brings juicy, refreshing flavor while Zkittlez adds that famous rainbow fruit candy sweetness. Infusion makes it a heavy hitter.â, category: âInfused Preroll 1.25gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/INF-Watermelon-Skittlez.jpgâ },
// Flower
âChem 91â: { type: âSativaâ, thc: â24-28%â, genetics: âChemdawg 91 (Original Chemdog cut)â, lineage: âOne of the original Chemdawg cuts â secured at a Grateful Dead concert in 1991. The genetic ancestor of OG Kush, Sour Diesel, and countless modern strainsâ, flavor: âSharp chemical, diesel, pine, funkâ, effects: âCerebral, creative, focused, upliftingâ, terpenes: âCaryophyllene, Myrcene, Limoneneâ, description: âCannabis royalty. Chem 91 is THE original Chemdog cut from the Grateful Dead era â the genetic foundation that birthed OG Kush and Sour Diesel. Pure East Coast history in every nug.â, category: âFlower 3.5gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/FLW-Chem-91.webpâ },
âBanana Cream Pieâ: { type: âIndicaâ, thc: â24-28%â, genetics: âBanana OG Ã Cookies & Creamâ, lineage: âBanana Kush Ã OG Kush â Banana OG | Starfighter Ã GSC â Cookies & Creamâ, flavor: âBanana cream, vanilla custard, sweet doughâ, effects: âRelaxed, euphoric, sleepy, happyâ, terpenes: âMyrcene, Limonene, Caryophylleneâ, description: âDessert genetics at their finest. Banana OGâs tropical sweetness meets Cookies & Creamâs rich vanilla. Like eating a banana cream pie that melts every muscle in your body.â, category: âFlower 3.5gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/FLW-Banana-Cream-Pie.webpâ },
âBlack Mapleâ: { type: âIndicaâ, thc: â25-29%â, genetics: âBlack Diamond Ã Maple Leaf Indicaâ, lineage: âBlackberry Ã Diamond OG â Black Diamond | Afghani landrace selection â Maple Leaf Indica (Sensi Seeds)â, flavor: âDark maple syrup, earthy, sweet berryâ, effects: âDeep relaxation, sedating, pain reliefâ, terpenes: âMyrcene, Caryophyllene, Humuleneâ, description: âA dark, mysterious indica that pours like liquid maple. Black Diamondâs purple, berry-forward profile meets Maple Leafâs old-school Afghani warmth for a nighttime knockout.â, category: âFlower 3.5gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/FLW-Black-Maple.webpâ },
âCandy Fumezâ: { type: âHybridâ, thc: â26-30%â, genetics: âCandy Rain Ã Sherbinski Grapefruitâ, lineage: âLondon Pound Cake Ã Gushers â Candy Rain | Sherbinskiâs Grapefruit phenotype selectionâ, flavor: âSweet candy, grapefruit, gasolineâ, effects: âEuphoric, creative, relaxed, socialâ, terpenes: âLimonene, Caryophyllene, Myrceneâ, description: âA candy store meets a gas station in the best way possible. The London Pound Cake lineage in Candy Rain brings sweetness while Grapefruit adds a bright citrus-gas contrast.â, category: âFlower 3.5gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/FLW-Candy-Fumez.webpâ },
âCarbon Fiberâ: { type: âHybridâ, thc: â27-31%â, genetics: âGrape Pie Ã Biscottiâ, lineage: âCherry Pie Ã Grape Stomper â Grape Pie | Gelato 25 Ã South Florida OG â Biscottiâ, flavor: âFruity, nutty, earthy, grapeâ, effects: âBalanced, creative, calm focusâ, terpenes: âCaryophyllene, Limonene, Humuleneâ, description: âSleek, potent, and engineered for performance â just like its namesake material. Grape Pie brings the fruity density while Biscotti adds toasted, nutty complexity.â, category: âFlower 3.5gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/FLW-Carbon-Fiber.webpâ },
âDulce De Uvaâ: { type: âIndicaâ, thc: â25-29%â, genetics: âGrape Cream Cake Ã Dulceâ, lineage: âGrape-dominant exotic phenotype Ã Dulce (sweet Latin-inspired cultivar)â, flavor: âGrape jam, caramel, sweet creamâ, effects: âRelaxed, happy, dreamy, sweetâ, terpenes: âMyrcene, Linalool, Caryophylleneâ, description: âThe name says it all â âGrape Sweetnessâ in Spanish. Rich grape jam flavor with caramel undertones. An indica that wraps you in a warm, dreamy sweetness.â, category: âFlower 3.5gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/FLW-Dulce-De-Uva.webpâ },
âGSCâ: { type: âHybridâ, thc: â25-29%â, genetics: âOG Kush Ã Durban Poisonâ, lineage: âChemdawg Ã Hindu Kush â OG Kush | South African sativa landrace â Durban Poison â originally bred by the Cookie Family in San Franciscoâ, flavor: âSweet cookie dough, earthy, mintâ, effects: âEuphoric, creative, full-body relaxedâ, terpenes: âCaryophyllene, Limonene, Humuleneâ, description: âGirl Scout Cookies â the strain that launched a thousand crosses. Born in San Francisco, GSC changed cannabis forever. OG Kushâs potency meets Durban Poisonâs euphoric energy.â, category: âFlower 3.5gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/FLW-GSC.webpâ },
âJelly Donutâ: { type: âIndicaâ, thc: â25-29%â, genetics: âJelly Breath Ã Dosidosâ, lineage: âMendo Breath Ã Do-Si-Dos â Jelly Breath | Face Off OG Ã OGKB â Dosidosâ, flavor: âSweet berry jam, doughy, sugar glazeâ, effects: âRelaxed, sleepy, euphoricâ, terpenes: âLinalool, Myrcene, Limoneneâ, description: âThe flower version of the preroll favorite. Dense, purple buds that smell exactly like a fresh jelly donut. Mendo Breath genetics bring heavy relaxation with a sweet, jammy finish.â, category: âFlower 3.5gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/FLW-Jelly-Donut.webpâ },
âLemon Cherry Gelatoâ: { type: âHybridâ, thc: â26-30%â, genetics: âSunset Sherbet Ã Girl Scout Cookies Ã (Lemon Ã Cherry)â, lineage: âPart of the Gelato family â Sunset Sherbet Ã Thin Mint GSC base with lemon and cherry phenotype expression selected by Backpackboyzâ, flavor: âLemon zest, cherry candy, creamy gelatoâ, effects: âUplifting, creative, relaxed, socialâ, terpenes: âLimonene, Caryophyllene, Linaloolâ, description: âThe most hyped Gelato phenotype in recent years. Bright lemon and cherry flavors shine through a creamy gelato base. The buds are dense, purple, and absolutely caked in trichomes.â, category: âFlower 3.5gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/FLW-Lemon-Cherry-Gelato.webpâ },
âNascarâ: { type: âSativaâ, thc: â24-28%â, genetics: âGMO Ã Trophy Wifeâ, lineage: âChemdawg Ã GSC â GMO | Unknown high-octane sativa cross â Trophy Wifeâ, flavor: âGassy, garlic, spicy, chemicalâ, effects: âFast-hitting energy, focused, creativeâ, terpenes: âCaryophyllene, Myrcene, Limoneneâ, description: âPedal to the metal. Nascar takes GMOâs pungent garlic gas and adds Trophy Wifeâs racing sativa energy. Named for the speed at which the effects hit you â full throttle from the first pull.â, category: âFlower 3.5gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/FLW-Nascar.webpâ },
âPinnacleâ: { type: âHybridâ, thc: â27-31%â, genetics: âRuntz Ã Gelatoâ, lineage: âZkittlez Ã Gelato â Runtz | Sunset Sherbet Ã Thin Mint GSC â Gelatoâ, flavor: âSweet candy, creamy, tropical fruitâ, effects: âPeak euphoria, balanced, creativeâ, terpenes: âLimonene, Caryophyllene, Linaloolâ, description: âThe name says it all â this is the peak. Runtzâs candy sweetness meets Gelatoâs creamy smoothness. Dense, colorful buds deliver what might be the most enjoyable smoke in the Dragonfly lineup.â, category: âFlower 3.5gâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/FLW-Pinnacle.webpâ },
// 1oz
âCreme De Mentheâ: { type: âHybridâ, thc: â24-28%â, genetics: âKush Mints Ã Gelatoâ, lineage: âAnimal Mints Ã Bubba Kush â Kush Mints | Sunset Sherbet Ã Thin Mint GSC â Gelatoâ, flavor: âCool mint, cream, sweet chocolateâ, effects: âRelaxed, uplifting, minty freshâ, terpenes: âLimonene, Caryophyllene, Myrceneâ, description: âAn after-dinner mint in flower form. Kush Mints brings the cool minty frost while Gelato adds creamy sweetness. Premium full ounce for the true connoisseur.â, category: â1oz Premium Flowerâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/FLW-Creme-De-Menthe.webpâ },
âFrostâ: { type: âHybridâ, thc: â26-30%â, genetics: âIce Cap Ã White Truffleâ, lineage: âFrozen Gelato Ã Ice Cream Cake â Ice Cap | Gorilla Butter phenotype â White Truffleâ, flavor: âIcy menthol, creamy, earthy, sweetâ, effects: âCool euphoria, balanced, relaxedâ, terpenes: âCaryophyllene, Limonene, Myrceneâ, description: âNamed for the blanket of trichomes that makes every nug look frozen. Ice Capâs icy gelato genetics meet White Truffleâs rare, creamy funk. Premium quality at scale.â, category: â1oz Premium Flowerâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/FLW-Frost.webpâ },
âHDGâ: { type: âIndicaâ, thc: â25-29%â, genetics: âHeavy Duty Genetics crossâ, lineage: âHeavy-hitting indica genetics â bred for maximum potency, density, and resin productionâ, flavor: âGas, earthy, sweet, pungentâ, effects: âPotent, sedating, full-body relaxationâ, terpenes: âMyrcene, Caryophyllene, Humuleneâ, description: âHDG â Heavy Duty hits different. Bred for people who need the strongest indica in the room. Dense, frosty nugs that deliver uncompromising relaxation in a full ounce.â, category: â1oz Premium Flowerâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/FLW-HDG.webpâ },
âWedding Crasherâ: { type: âHybridâ, thc: â25-29%â, genetics: âWedding Cake Ã Purple Punchâ, lineage: âCherry Pie Ã GSC â Wedding Cake | Larry OG Ã Granddaddy Purple â Purple Punchâ, flavor: âSweet vanilla, grape candy, creamy cakeâ, effects: âSocial, euphoric, relaxed, creativeâ, terpenes: âLimonene, Caryophyllene, Myrceneâ, description: âCrashing the party with style. Wedding Cakeâs sweet vanilla meets Purple Punchâs grape candy for an irresistible combination. The life of every smoke session.â, category: â1oz Premium Flowerâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/FLW-Wedding-Crasher.webpâ },
// Vapes (All-In-One + Carts) - flavor/effect focused
âBlue Razzâ: { type: âSativaâ, thc: â85-90%â, genetics: âBlue Raspberry terpene profile (Blue Dream lineage)â, lineage: âBlueberry Ã Haze inspired terpene blend â blue raspberry candy flavor engineered from natural cannabis terpenesâ, flavor: âBlue raspberry candy, sweet berry, tartâ, effects: âEnergetic, uplifting, happyâ, terpenes: âMyrcene, Pinene, Limoneneâ, description: âThe blue raspberry experience perfected for vape. Inspired by Blue Dream genetics, this captures the iconic candy shop flavor with a bright, energizing sativa buzz.â, category: âVapeâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/VAPE-Blue-Razz.webpâ },
âDouble Bubble OGâ: { type: âIndicaâ, thc: â85-90%â, genetics: âBubble Gum Ã OG Kushâ, lineage: âIndiana Bubble Gum Ã OG Kush â old-school bubblegum genetics meet modern OG potencyâ, flavor: âClassic bubblegum, sweet, earthy OGâ, effects: âRelaxed, nostalgic, happyâ, terpenes: âMyrcene, Caryophyllene, Limoneneâ, description: âThat classic bubblegum flavor from the bag you used to get at the corner store â now in a vape. Indiana Bubble Gum genetics meet OG Kushâs legendary relaxation.â, category: âVapeâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/VAPE-Double-Bubble-OG.webpâ },
âElectric Watermelon OGâ: { type: âHybridâ, thc: â85-90%â, genetics: âWatermelon Ã OG Kushâ, lineage: âWatermelon phenotype Ã OG Kush â electrified watermelon flavor with classic OG backboneâ, flavor: âSweet watermelon, electric citrus, earthy OGâ, effects: âBalanced, uplifting, relaxedâ, terpenes: âLimonene, Myrcene, Caryophylleneâ, description: âWatermelon that hits you with a jolt. The watermelon phenotypeâs juicy sweetness gets an OG Kush backbone for balance. Like biting into a watermelon that bites back.â, category: âVapeâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/VAPE-Electric-Watermelon-OG.webpâ },
âForbidden Fruitâ: { type: âIndicaâ, thc: â85-90%â, genetics: âCherry Pie Ã Tangieâ, lineage: âGranddaddy Purple Ã Durban Poison â Cherry Pie | California Orange Ã Skunk â Tangieâ, flavor: âTropical passionfruit, cherry, mangoâ, effects: âDeeply relaxing, exotic, dreamyâ, terpenes: âMyrcene, Limonene, Pineneâ, description: âThe most exotic fruit salad youâll ever taste. Cherry Pieâs berry sweetness meets Tangieâs tropical citrus for a flavor so good it feels like it shouldnât be allowed.â, category: âVapeâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/VAPE-Forbidden-Fruit.webpâ },
âLemon Dropâ: { type: âSativaâ, thc: â85-90%â, genetics: âLemon OG Ã Sour Dieselâ, lineage: âLemon Skunk Ã OG Kush â Lemon OG | Chemdawg Ã MSSS Ã NL â Sour Dieselâ, flavor: âSharp lemon candy, sour, sweet citrusâ, effects: âEnergizing, focused, mood-boostingâ, terpenes: âLimonene, Pinene, Caryophylleneâ, description: âPure lemon candy energy in a vape. Lemon OG brings the citrus bomb while Sour Diesel adds sativa fuel. Like squeezing a lemon straight into your brain â in a good way.â, category: âVapeâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/VAPE-Lemon-Drop.webpâ },
âRainbow Beltzâ: { type: âHybridâ, thc: â85-90%â, genetics: âZkittlez Ã Moonbowâ, lineage: âGrape Ape Ã Grapefruit â Zkittlez | Zkittlez Ã Do-Si-Dos â Moonbowâ, flavor: âSour rainbow candy, fruity, sweet-tartâ, effects: âEuphoric, creative, balancedâ, terpenes: âCaryophyllene, Limonene, Myrceneâ, description: âTastes exactly like the sour candy belt. Zkittlez appears on both sides of the lineage for double the fruit, while Moonbow adds exotic complexity. A candy loverâs dream.â, category: âVapeâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/VAPE-Rainbow-Beltz.webpâ },
âRed Razzleberryâ: { type: âSativaâ, thc: â85-90%â, genetics: âRaspberry Kush Ã Berry Whiteâ, lineage: âRaspberry-forward phenotype selection Ã White Widow Ã Blueberry â Berry Whiteâ, flavor: âRed raspberry, mixed berry, sweet tartâ, effects: âUplifting, social, creativeâ, terpenes: âMyrcene, Limonene, Pineneâ, description: âRed berry explosion. The raspberry phenotype delivers intense, authentic berry flavor while Berry White adds smooth, creamy sweetness. A fruit-forward sativa youâll keep hitting.â, category: âVapeâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/VAPE-Red-Razzleberry.webpâ },
âGreen Appleâ: { type: âSativaâ, thc: â85-90%â, genetics: âGreen Apple Runtz (Zkittlez Ã Gelato)â, lineage: âGreen apple phenotype of Runtz â Zkittlez Ã Gelato with selected green apple terpene expressionâ, flavor: âSour green apple, candy, tart citrusâ, effects: âEnergetic, focused, euphoricâ, terpenes: âLimonene, Pinene, Terpinoleneâ, description: âSour green apple candy in a cart. This Runtz phenotype was selected specifically for its bright, tart apple flavor. Sativa energy with candy shop appeal.â, category: âVapeâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/VAPE-Green-Apple.webpâ },
âOrange Creamsicleâ: { type: âHybridâ, thc: â85-90%â, genetics: âOrange Crush Ã Juicy Fruitâ, lineage: âCalifornia Orange Ã Blueberry â Orange Crush | Afghani Ã Thai â Juicy Fruitâ, flavor: âCreamy orange, vanilla ice cream, tangyâ, effects: âUplifting, relaxed, nostalgicâ, terpenes: âLimonene, Myrcene, Linaloolâ, description: âThe ice cream truck in a cart. Orange Crushâs bright citrus meets Juicy Fruitâs tropical sweetness for a creamy, dreamy vape that tastes like summer childhood.â, category: âVapeâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/VAPE-Orange-Creamsicle.webpâ },
âPapaya Punchâ: { type: âIndicaâ, thc: â85-90%â, genetics: âPapaya Ã Purple Punchâ, lineage: âCitral #13 Ã Ice #2 â Papaya | Larry OG Ã Granddaddy Purple â Purple Punchâ, flavor: âTropical papaya, grape punch, sweet creamâ, effects: âRelaxing, tropical, sleepyâ, terpenes: âMyrcene, Limonene, Caryophylleneâ, description: âA tropical knockout. Papayaâs exotic fruit sweetness gets amped up with Purple Punchâs grape candy power. Close your eyes and youâre on a hammock somewhere warm.â, category: âVapeâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/09/VAPE-Papaya-Punch.webpâ },
âMelted Strawberriesâ: { type: âHybridâ, thc: â24-28%â, genetics: âStrawberry Guava Ã Gelatoâ, lineage: âStrawberry phenotype Ã Guava cross â Strawberry Guava | Sunset Sherbet Ã Thin Mint GSC â Gelatoâ, flavor: âMelted strawberry, cream, sweet jamâ, effects: âEuphoric, relaxed, happyâ, terpenes: âMyrcene, Limonene, Linaloolâ, description: âLike strawberries left in the sun â warm, sweet, and dripping with flavor. The 14-pack gives you this premium hybrid experience for sharing or savoring all week.â, category: â14 Pack Prerollsâ , image: âhttps://dragonflybrandny.com/wp-content/uploads/2025/12/14P-Melted-Strawberries-1.webpâ },
};

// âââ App Styles ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const COLORS = {
bg: â#0a0a0aâ,
bgCard: â#141414â,
bgElevated: â#1a1a1aâ,
bgGlass: ârgba(255,255,255,0.03)â,
text: â#ffffffâ,
textMuted: â#888888â,
textDim: â#555555â,
accent: â#c8ff00â,       // Dragonfly uses a bright lime/chartreuse
accentDim: ârgba(200,255,0,0.15)â,
border: ârgba(255,255,255,0.08)â,
borderLight: ârgba(255,255,255,0.12)â,
indica: â#8b5cf6â,
sativa: â#f59e0bâ,
hybrid: â#10b981â,
success: â#22c55eâ,
error: â#ef4444â,
};

const FONTS = {
display: ââOswaldâ, sans-serifâ,
body: ââDM Sansâ, sans-serifâ,
mono: ââJetBrains Monoâ, monospaceâ,
};

// âââ Component: App ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
export default function DragonflyScanner() {
const [screen, setScreen] = useState(âhomeâ); // home | scan | result | signup | thanks
const [scannedStrain, setScannedStrain] = useState(null);
const [scannedProduct, setScannedProduct] = useState(null);
const [searchQuery, setSearchQuery] = useState(ââ);
const [showSearch, setShowSearch] = useState(false);
const [signupData, setSignupData] = useState({ name: ââ, email: ââ, phone: ââ, age: false });
const [submitting, setSubmitting] = useState(false);
const [submitError, setSubmitError] = useState(null);
const [scanStatus, setScanStatus] = useState(ââ);
const canvasRef = useRef(null);
const [cameraActive, setCameraActive] = useState(false);
const [scanning, setScanning] = useState(false);
const [scanProgress, setScanProgress] = useState(0);
const videoRef = useRef(null);
const streamRef = useRef(null);
const fileInputRef = useRef(null);

// Load Google Fonts
useEffect(() => {
const link = document.createElement(âlinkâ);
link.href = âhttps://fonts.googleapis.com/css2?family=Oswald:wght@300;400;500;600;700&family=DM+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swapâ;
link.rel = âstylesheetâ;
document.head.appendChild(link);
}, []);

const strainNames = Object.keys(STRAIN_DB);
const filteredStrains = searchQuery.length > 0
? strainNames.filter(s => s.toLowerCase().includes(searchQuery.toLowerCase()))
: [];

// Camera functions
const [cameraError, setCameraError] = useState(null);

const startCamera = useCallback(async () => {
setCameraError(null);
try {
// Check if getUserMedia is available (wonât work in iframes/Claude preview)
if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
setCameraError(âCamera not available in this environment. Use photo upload instead.â);
setCameraActive(false);
return;
}
const stream = await navigator.mediaDevices.getUserMedia({
video: { facingMode: âenvironmentâ, width: { ideal: 1280 }, height: { ideal: 720 } }
});
streamRef.current = stream;
if (videoRef.current) {
videoRef.current.srcObject = stream;
await videoRef.current.play();
// Check if video is actually producing frames after a short delay
setTimeout(() => {
if (videoRef.current && (videoRef.current.videoWidth === 0 || videoRef.current.videoHeight === 0)) {
setCameraError(âCamera connected but no video feed. Try uploading a photo instead.â);
}
}, 2000);
}
setCameraActive(true);
} catch (err) {
console.error(âCamera error:â, err.name, err.message);
if (err.name === âNotAllowedErrorâ) {
setCameraError(âCamera permission denied. Tap âUpload a photoâ below instead.â);
} else if (err.name === âNotFoundErrorâ) {
setCameraError(âNo camera found on this device. Use photo upload instead.â);
} else if (err.name === âNotReadableErrorâ) {
setCameraError(âCamera is in use by another app. Try closing other apps or upload a photo.â);
} else {
setCameraError(âCouldnât access camera. Use photo upload below.â);
}
setCameraActive(false);
}
}, []);

const stopCamera = useCallback(() => {
if (streamRef.current) {
streamRef.current.getTracks().forEach(t => t.stop());
streamRef.current = null;
}
setCameraActive(false);
}, []);

// âââ Resize image to reduce API payload âââââââââââââââââââââââââââââââââ
const resizeImage = (dataUrl, maxDim = 800) => {
return new Promise((resolve) => {
const img = new Image();
img.onload = () => {
let w = img.width, h = img.height;
if (w > maxDim || h > maxDim) {
const scale = maxDim / Math.max(w, h);
w = Math.round(w * scale);
h = Math.round(h * scale);
}
const c = document.createElement(âcanvasâ);
c.width = w; c.height = h;
c.getContext(â2dâ).drawImage(img, 0, 0, w, h);
resolve(c.toDataURL(âimage/jpegâ, 0.85));
};
img.src = dataUrl;
});
};

// âââ Claude Vision API: Identify strain from product photo ââââââââââââ
const identifyWithVision = useCallback(async (imageSource) => {
setScanning(true);
setScanProgress(10);
setScanStatus(âCapturing imageâ¦â);

```
try {
  let imageSrc = imageSource;
  
  // If from video feed, capture a frame
  if (imageSource === "camera" && videoRef.current) {
    const canvas = document.createElement("canvas");
    const video = videoRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    imageSrc = canvas.toDataURL("image/jpeg", 0.85);
  }
  
  setScanProgress(20);
  setScanStatus("Preparing for analysis...");
  
  // Resize to keep API payload small
  const resized = await resizeImage(imageSrc);
  const base64 = resized.split(",")[1];
  const mediaType = resized.startsWith("data:image/png") ? "image/png" : "image/jpeg";
  
  setScanProgress(30);
  setScanStatus("AI analyzing product...");
  
  const strainList = strainNames.join(", ");
  
  const response = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_base64: base64,
      media_type: mediaType,
      strain_list: strainList,
    })
  });
  
  setScanProgress(70);
  setScanStatus("Processing result...");
  
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Server error: ${response.status}`);
  }
  
  const result = await response.json();
  const aiResponse = (result.strain || "UNKNOWN").trim();
  const scannedProductType = result.product_type || null;
  
  console.log("Claude Vision raw response:", JSON.stringify(result));
  console.log("Strain identified:", aiResponse, "Product:", scannedProductType);
  
  setScanProgress(90);
  setScanStatus(`Matching: "${aiResponse}"...`);
  
  // Match the AI response against our strain database
  let matched = null;
  
  // Exact match (case-sensitive)
  if (STRAIN_DB[aiResponse]) {
    matched = aiResponse;
  }
  
  // Case-insensitive exact match
  if (!matched) {
    const aiLower = aiResponse.toLowerCase().trim();
    for (const name of strainNames) {
      if (name.toLowerCase() === aiLower) { matched = name; break; }
    }
  }
  
  // Partial/substring match
  if (!matched && aiResponse !== "UNKNOWN") {
    const aiLower = aiResponse.toLowerCase();
    for (const name of strainNames) {
      const nameLower = name.toLowerCase();
      if (aiLower.includes(nameLower) || nameLower.includes(aiLower)) { matched = name; break; }
    }
  }
  
  // Fuzzy edit distance match
  if (!matched && aiResponse !== "UNKNOWN" && aiResponse.length >= 3) {
    matched = fuzzyMatch(aiResponse, strainNames);
  }
  
  setScanProgress(100);
  
  if (matched) {
    const hasProductType = scannedProductType && scannedProductType !== "UNKNOWN" && scannedProductType !== "null";
    
    if (hasProductType) {
      setScanStatus(`Identified: ${matched}`);
      setTimeout(() => {
        setScanning(false);
        setScanStatus("");
        setScannedStrain(matched);
        setScannedProduct(scannedProductType);
        stopCamera();
        setScreen("result");
      }, 800);
    } else {
      setScanStatus(`Found: ${matched}!`);
      setTimeout(() => {
        setScanning(false);
        setScanStatus("");
        setScannedStrain(matched);
        setScannedProduct(null);
        stopCamera();
        setScreen("pickProduct");
      }, 800);
    }
  } else {
    setScanStatus(aiResponse === "UNKNOWN" 
      ? "Couldn't read the label. Try a clearer, well-lit photo."
      : `Read "${aiResponse}" but couldn't match it. Try again or search manually.`
    );
    setTimeout(() => {
      setScanning(false);
      setScanProgress(0);
      setScanStatus("");
    }, 4000);
  }
} catch (err) {
  console.error("Vision API error:", err);
  let errorMsg = "Scan failed. Try again or search manually.";
  if (err.message?.includes("Failed to fetch") || err.message?.includes("NetworkError")) {
    errorMsg = "Can't reach scan server. Deploy to Railway first, then scan will work.";
  } else if (err.message?.includes("ANTHROPIC_API_KEY")) {
    errorMsg = "API key not configured. Add ANTHROPIC_API_KEY in Railway variables.";
  } else if (err.message?.includes("502") || err.message?.includes("Vision API")) {
    errorMsg = "Vision API error. Check your API key in Railway.";
  }
  setScanStatus(errorMsg);
  setTimeout(() => {
    setScanning(false);
    setScanProgress(0);
    setScanStatus("");
  }, 4000);
}
```

}, [strainNames, stopCamera]);

const handleFileUpload = (e) => {
const file = e.target.files[0];
if (file) {
const reader = new FileReader();
reader.onload = (ev) => {
identifyWithVision(ev.target.result);
};
reader.readAsDataURL(file);
}
};

const goHome = () => {
stopCamera();
setScreen(âhomeâ);
setScannedStrain(null);
setScannedProduct(null);
setSearchQuery(ââ);
setShowSearch(false);
setScanning(false);
setScanProgress(0);
};

const typeColor = (type) => {
if (type === âIndicaâ) return COLORS.indica;
if (type === âSativaâ) return COLORS.sativa;
return COLORS.hybrid;
};

// âââ Styles ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const styles = {
app: {
fontFamily: FONTS.body,
background: COLORS.bg,
color: COLORS.text,
minHeight: â100vhâ,
minHeight: â100dvhâ,
width: â100%â,
position: ârelativeâ,
overflow: âhiddenâ,
WebkitFontSmoothing: âantialiasedâ,
MozOsxFontSmoothing: âgrayscaleâ,
},
header: {
display: âflexâ,
alignItems: âcenterâ,
justifyContent: âspace-betweenâ,
padding: â12px 16pxâ,
paddingTop: âmax(12px, env(safe-area-inset-top))â,
borderBottom: `1px solid ${COLORS.border}`,
background: ârgba(10,10,10,0.95)â,
backdropFilter: âblur(20px)â,
WebkitBackdropFilter: âblur(20px)â,
position: âstickyâ,
top: 0,
zIndex: 100,
},
logo: {
fontFamily: FONTS.display,
fontSize: 22,
fontWeight: 700,
letterSpacing: â0.08emâ,
textTransform: âuppercaseâ,
color: COLORS.text,
cursor: âpointerâ,
},
logoAccent: {
color: COLORS.accent,
},
navBtn: {
background: ânoneâ,
border: `1px solid ${COLORS.border}`,
color: COLORS.textMuted,
padding: â10px 16pxâ,
minHeight: 44,
borderRadius: 8,
fontSize: 13,
fontFamily: FONTS.body,
fontWeight: 500,
cursor: âpointerâ,
transition: âall 0.15sâ,
display: âflexâ,
alignItems: âcenterâ,
gap: 6,
},
heroSection: {
padding: â48px 20px 32pxâ,
textAlign: âcenterâ,
position: ârelativeâ,
},
heroTagline: {
fontFamily: FONTS.display,
fontSize: 12,
fontWeight: 300,
letterSpacing: â0.25emâ,
textTransform: âuppercaseâ,
color: COLORS.textMuted,
marginBottom: 14,
},
heroTitle: {
fontFamily: FONTS.display,
fontSize: âclamp(36px, 10vw, 48px)â,
fontWeight: 700,
lineHeight: 1.0,
letterSpacing: â-0.01emâ,
textTransform: âuppercaseâ,
marginBottom: 14,
},
heroSub: {
fontSize: 15,
color: COLORS.textMuted,
lineHeight: 1.6,
maxWidth: 320,
margin: â0 auto 36pxâ,
},
scanBtn: {
display: âinline-flexâ,
alignItems: âcenterâ,
justifyContent: âcenterâ,
gap: 10,
background: COLORS.accent,
color: â#000â,
border: ânoneâ,
padding: â18px 36pxâ,
minHeight: 56,
borderRadius: 50,
fontSize: 16,
fontFamily: FONTS.display,
fontWeight: 600,
letterSpacing: â0.08emâ,
textTransform: âuppercaseâ,
cursor: âpointerâ,
transition: âtransform 0.15s, opacity 0.15sâ,
boxShadow: `0 0 40px ${COLORS.accentDim}`,
WebkitTapHighlightColor: âtransparentâ,
touchAction: âmanipulationâ,
},
browseBtn: {
display: âinline-flexâ,
alignItems: âcenterâ,
justifyContent: âcenterâ,
gap: 8,
background: âtransparentâ,
color: COLORS.textMuted,
border: `1px solid ${COLORS.borderLight}`,
padding: â14px 28pxâ,
minHeight: 50,
borderRadius: 50,
fontSize: 14,
fontFamily: FONTS.display,
fontWeight: 500,
letterSpacing: â0.08emâ,
textTransform: âuppercaseâ,
cursor: âpointerâ,
marginTop: 16,
transition: âall 0.15sâ,
WebkitTapHighlightColor: âtransparentâ,
touchAction: âmanipulationâ,
},
featureGrid: {
display: âgridâ,
gridTemplateColumns: â1fr 1fr 1frâ,
gap: 12,
padding: â0 20px 40pxâ,
},
featureCard: {
background: COLORS.bgCard,
border: `1px solid ${COLORS.border}`,
borderRadius: 12,
padding: â20px 12pxâ,
textAlign: âcenterâ,
},
featureIcon: {
fontSize: 28,
marginBottom: 8,
},
featureLabel: {
fontFamily: FONTS.display,
fontSize: 11,
fontWeight: 500,
letterSpacing: â0.1emâ,
textTransform: âuppercaseâ,
color: COLORS.textMuted,
},
// Scan screen
scanContainer: {
padding: 20,
display: âflexâ,
flexDirection: âcolumnâ,
alignItems: âcenterâ,
gap: 20,
},
videoWrapper: {
width: â100%â,
maxWidth: 400,
aspectRatio: â4/3â,
borderRadius: 16,
overflow: âhiddenâ,
background: â#111â,
position: ârelativeâ,
border: `2px solid ${COLORS.border}`,
},
video: {
width: â100%â,
height: â100%â,
objectFit: âcoverâ,
},
scanOverlay: {
position: âabsoluteâ,
inset: 0,
display: âflexâ,
alignItems: âcenterâ,
justifyContent: âcenterâ,
background: ârgba(0,0,0,0.3)â,
},
scanFrame: {
width: â70%â,
height: â60%â,
border: `2px solid ${COLORS.accent}`,
borderRadius: 12,
boxShadow: `0 0 60px ${COLORS.accentDim}, inset 0 0 60px rgba(200,255,0,0.05)`,
animation: âpulse 2s infiniteâ,
},
progressBar: {
width: â100%â,
maxWidth: 400,
height: 4,
background: COLORS.bgCard,
borderRadius: 2,
overflow: âhiddenâ,
},
progressFill: (pct) => ({
width: `${Math.min(pct, 100)}%`,
height: â100%â,
background: `linear-gradient(90deg, ${COLORS.accent}, #9eff00)`,
transition: âwidth 0.2s ease-outâ,
borderRadius: 2,
}),
orDivider: {
display: âflexâ,
alignItems: âcenterâ,
gap: 16,
width: â100%â,
maxWidth: 400,
color: COLORS.textDim,
fontSize: 12,
fontFamily: FONTS.display,
letterSpacing: â0.15emâ,
textTransform: âuppercaseâ,
},
dividerLine: {
flex: 1,
height: 1,
background: COLORS.border,
},
uploadBtn: {
width: â100%â,
maxWidth: 400,
padding: â14px 20pxâ,
background: COLORS.bgCard,
border: `1px dashed ${COLORS.borderLight}`,
borderRadius: 12,
color: COLORS.textMuted,
fontSize: 14,
fontFamily: FONTS.body,
cursor: âpointerâ,
textAlign: âcenterâ,
transition: âall 0.2sâ,
},
// Result screen
resultContainer: {
padding: â0 20px 40pxâ,
},
strainHeader: {
padding: â32px 0 24pxâ,
textAlign: âcenterâ,
},
typeBadge: (color) => ({
display: âinline-blockâ,
padding: â4px 14pxâ,
borderRadius: 50,
fontSize: 11,
fontFamily: FONTS.display,
fontWeight: 600,
letterSpacing: â0.12emâ,
textTransform: âuppercaseâ,
color: color,
background: color + â18â,
border: `1px solid ${color}40`,
marginBottom: 12,
}),
strainName: {
fontFamily: FONTS.display,
fontSize: 38,
fontWeight: 700,
textTransform: âuppercaseâ,
lineHeight: 1.0,
marginBottom: 8,
},
strainCategory: {
fontSize: 13,
color: COLORS.textMuted,
fontFamily: FONTS.mono,
fontWeight: 400,
},
infoSection: {
background: COLORS.bgCard,
border: `1px solid ${COLORS.border}`,
borderRadius: 16,
padding: 20,
marginBottom: 16,
},
sectionTitle: {
fontFamily: FONTS.display,
fontSize: 12,
fontWeight: 600,
letterSpacing: â0.15emâ,
textTransform: âuppercaseâ,
color: COLORS.accent,
marginBottom: 12,
},
statGrid: {
display: âgridâ,
gridTemplateColumns: â1fr 1frâ,
gap: 12,
},
statItem: {
background: COLORS.bgGlass,
borderRadius: 10,
padding: â12px 14pxâ,
},
statLabel: {
fontSize: 10,
fontFamily: FONTS.display,
fontWeight: 500,
letterSpacing: â0.12emâ,
textTransform: âuppercaseâ,
color: COLORS.textDim,
marginBottom: 4,
},
statValue: {
fontSize: 14,
fontWeight: 600,
color: COLORS.text,
},
geneticsBox: {
background: COLORS.bgGlass,
borderRadius: 10,
padding: 14,
marginBottom: 12,
},
geneticsLabel: {
fontSize: 10,
fontFamily: FONTS.display,
fontWeight: 500,
letterSpacing: â0.12emâ,
textTransform: âuppercaseâ,
color: COLORS.textDim,
marginBottom: 6,
},
geneticsValue: {
fontSize: 15,
fontWeight: 600,
color: COLORS.accent,
lineHeight: 1.4,
},
lineageText: {
fontSize: 13,
color: COLORS.textMuted,
lineHeight: 1.7,
fontFamily: FONTS.mono,
fontWeight: 400,
},
descText: {
fontSize: 14,
color: COLORS.textMuted,
lineHeight: 1.7,
},
ctaSection: {
background: `linear-gradient(135deg, ${COLORS.bgCard}, ${COLORS.bgElevated})`,
border: `1px solid ${COLORS.accent}30`,
borderRadius: 16,
padding: 24,
textAlign: âcenterâ,
marginTop: 24,
},
ctaTitle: {
fontFamily: FONTS.display,
fontSize: 20,
fontWeight: 600,
textTransform: âuppercaseâ,
marginBottom: 8,
},
ctaText: {
fontSize: 13,
color: COLORS.textMuted,
marginBottom: 20,
},
ctaBtn: {
display: âinline-flexâ,
alignItems: âcenterâ,
gap: 8,
background: COLORS.accent,
color: â#000â,
border: ânoneâ,
padding: â14px 32pxâ,
borderRadius: 50,
fontSize: 14,
fontFamily: FONTS.display,
fontWeight: 600,
letterSpacing: â0.08emâ,
textTransform: âuppercaseâ,
cursor: âpointerâ,
},
// Signup form
formContainer: {
padding: â20px 20px 40pxâ,
},
formTitle: {
fontFamily: FONTS.display,
fontSize: 32,
fontWeight: 700,
textTransform: âuppercaseâ,
textAlign: âcenterâ,
marginBottom: 8,
},
formSub: {
fontSize: 14,
color: COLORS.textMuted,
textAlign: âcenterâ,
marginBottom: 32,
},
inputGroup: {
marginBottom: 18,
},
inputLabel: {
display: âblockâ,
fontSize: 11,
fontFamily: FONTS.display,
fontWeight: 500,
letterSpacing: â0.12emâ,
textTransform: âuppercaseâ,
color: COLORS.textMuted,
marginBottom: 8,
},
input: {
width: â100%â,
padding: â16pxâ,
background: COLORS.bgCard,
border: `1px solid ${COLORS.border}`,
borderRadius: 12,
color: COLORS.text,
fontSize: 16,
fontFamily: FONTS.body,
outline: ânoneâ,
transition: âborder-color 0.15sâ,
boxSizing: âborder-boxâ,
WebkitAppearance: ânoneâ,
appearance: ânoneâ,
},
checkboxRow: {
display: âflexâ,
alignItems: âflex-startâ,
gap: 12,
marginBottom: 28,
padding: â8px 0â,
},
checkbox: {
width: 22,
height: 22,
minWidth: 22,
marginTop: 1,
accentColor: COLORS.accent,
},
checkboxLabel: {
fontSize: 14,
color: COLORS.textMuted,
lineHeight: 1.5,
},
submitBtn: {
width: â100%â,
padding: â18pxâ,
minHeight: 56,
background: COLORS.accent,
color: â#000â,
border: ânoneâ,
borderRadius: 50,
fontSize: 16,
fontFamily: FONTS.display,
fontWeight: 600,
letterSpacing: â0.08emâ,
textTransform: âuppercaseâ,
cursor: âpointerâ,
transition: âtransform 0.15s, opacity 0.15sâ,
WebkitTapHighlightColor: âtransparentâ,
touchAction: âmanipulationâ,
},
submitBtnDisabled: {
opacity: 0.4,
cursor: ânot-allowedâ,
},
// Thanks screen
thanksContainer: {
padding: â80px 24pxâ,
textAlign: âcenterâ,
},
thanksIcon: {
fontSize: 64,
marginBottom: 24,
},
thanksTitle: {
fontFamily: FONTS.display,
fontSize: 36,
fontWeight: 700,
textTransform: âuppercaseâ,
marginBottom: 12,
},
thanksText: {
fontSize: 15,
color: COLORS.textMuted,
lineHeight: 1.6,
maxWidth: 300,
margin: â0 auto 36pxâ,
},
// Search overlay
searchOverlay: {
position: âfixedâ,
inset: 0,
background: ârgba(0,0,0,0.98)â,
zIndex: 200,
display: âflexâ,
flexDirection: âcolumnâ,
paddingTop: âenv(safe-area-inset-top)â,
paddingBottom: âenv(safe-area-inset-bottom)â,
},
searchHeader: {
display: âflexâ,
alignItems: âcenterâ,
gap: 12,
padding: â12px 16pxâ,
borderBottom: `1px solid ${COLORS.border}`,
},
searchInput: {
flex: 1,
padding: â12px 0â,
background: âtransparentâ,
border: ânoneâ,
color: COLORS.text,
fontSize: 17,
fontFamily: FONTS.body,
outline: ânoneâ,
WebkitAppearance: ânoneâ,
},
searchClose: {
background: ânoneâ,
border: ânoneâ,
color: COLORS.textMuted,
fontSize: 15,
fontFamily: FONTS.body,
cursor: âpointerâ,
padding: â10px 14pxâ,
minHeight: 44,
},
searchResults: {
flex: 1,
overflowY: âautoâ,
padding: â12px 20pxâ,
},
searchItem: {
display: âflexâ,
alignItems: âcenterâ,
justifyContent: âspace-betweenâ,
padding: â16pxâ,
minHeight: 64,
background: COLORS.bgCard,
border: `1px solid ${COLORS.border}`,
borderRadius: 12,
marginBottom: 8,
cursor: âpointerâ,
transition: âall 0.15sâ,
touchAction: âmanipulationâ,
},
searchItemName: {
fontSize: 15,
fontWeight: 600,
},
searchItemMeta: {
fontSize: 12,
color: COLORS.textMuted,
},
// Footer
footer: {
padding: â32px 20pxâ,
paddingBottom: âmax(32px, env(safe-area-inset-bottom))â,
borderTop: `1px solid ${COLORS.border}`,
textAlign: âcenterâ,
},
footerText: {
fontSize: 11,
color: COLORS.textDim,
fontFamily: FONTS.mono,
letterSpacing: â0.05emâ,
},
backBtn: {
background: ânoneâ,
border: ânoneâ,
color: COLORS.textMuted,
fontSize: 14,
fontFamily: FONTS.body,
cursor: âpointerâ,
padding: â8px 0â,
display: âflexâ,
alignItems: âcenterâ,
gap: 6,
},
terpTag: {
display: âinline-blockâ,
padding: â4px 10pxâ,
borderRadius: 6,
fontSize: 12,
fontFamily: FONTS.mono,
background: COLORS.bgGlass,
border: `1px solid ${COLORS.border}`,
color: COLORS.textMuted,
marginRight: 6,
marginBottom: 6,
},
};

// âââ Render: Search Overlay ââââââââââââââââââââââââââââââââââââââââââââââ
const renderSearch = () => {
if (!showSearch) return null;
return (
<div style={styles.searchOverlay}>
<div style={styles.searchHeader}>
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.textMuted} strokeWidth="2">
<circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
</svg>
<input
style={styles.searchInput}
placeholder=âSearch strainsâ¦â
value={searchQuery}
onChange={e => setSearchQuery(e.target.value)}
autoFocus
/>
<button style={styles.searchClose} onClick={() => { setShowSearch(false); setSearchQuery(ââ); }}>
Cancel
</button>
</div>
<div style={styles.searchResults}>
{searchQuery.length === 0 && (
<div style={{ padding: â40px 0â, textAlign: âcenterâ, color: COLORS.textDim, fontSize: 14 }}>
Type a strain name to search
</div>
)}
{filteredStrains.map(name => {
const s = STRAIN_DB[name];
return (
<div
key={name}
style={{ â¦styles.searchItem, display: âflexâ, alignItems: âcenterâ, gap: 12 }}
onClick={() => {
setScannedStrain(name);
setShowSearch(false);
setSearchQuery(ââ);
setScreen(âresultâ);
}}
>
{s.image && (
<div style={{ width: 44, height: 44, borderRadius: 8, overflow: âhiddenâ, flexShrink: 0, background: COLORS.bgCard }}>
<img src={s.image} alt={name} style={{ width: â100%â, height: â100%â, objectFit: âcoverâ }} onError={(e) => { e.target.style.display = ânoneâ; }} />
</div>
)}
<div style={{ flex: 1 }}>
<div style={styles.searchItemName}>{name}</div>
<div style={styles.searchItemMeta}>{s.category} Â· {s.type}</div>
</div>
<div style={{ â¦styles.typeBadge(typeColor(s.type)), marginBottom: 0, fontSize: 10 }}>
{s.type}
</div>
</div>
);
})}
{searchQuery.length > 0 && filteredStrains.length === 0 && (
<div style={{ padding: â40px 0â, textAlign: âcenterâ, color: COLORS.textDim, fontSize: 14 }}>
No strains found for â{searchQuery}â
</div>
)}
</div>
</div>
);
};

// âââ Render: Home ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const renderHome = () => (
<>
{/* Hero â Dragonfly Wings + Joint visual */}
<div style={{
position: ârelativeâ,
width: â100%â,
minHeight: â85dvhâ,
display: âflexâ,
flexDirection: âcolumnâ,
alignItems: âcenterâ,
justifyContent: âcenterâ,
padding: â40px 20px 32pxâ,
overflow: âhiddenâ,
}}>
{/* Background glow */}
<div style={{
position: âabsoluteâ,
top: â30%â,
left: â50%â,
transform: âtranslate(-50%, -50%)â,
width: â120%â,
height: â60%â,
background: `radial-gradient(ellipse at center, ${COLORS.accentDim}, transparent 70%)`,
opacity: 0.4,
pointerEvents: ânoneâ,
}} />

```
    {/* Wings image â the signature dragonfly wingspan */}
    <div style={{
      position: "relative",
      width: "100%",
      maxWidth: 380,
      marginBottom: -30,
      zIndex: 1,
    }}>
      <img
        src="https://dragonflybrandny.com/wp-content/uploads/2025/09/dragonfly-wings-1024x340.webp"
        alt="Dragonfly Wings"
        style={{
          width: "100%",
          height: "auto",
          display: "block",
          filter: "drop-shadow(0 0 40px rgba(200,255,0,0.15))",
        }}
      />
    </div>

    {/* Preroll / joint image â the body of the dragonfly */}
    <div style={{
      position: "relative",
      width: 140,
      marginBottom: 24,
      zIndex: 2,
    }}>
      <img
        src="https://dragonflybrandny.com/wp-content/uploads/2025/09/dragonfly-preroll-1024x944.webp"
        alt="Dragonfly Preroll"
        style={{
          width: "100%",
          height: "auto",
          display: "block",
          filter: "drop-shadow(0 8px 32px rgba(0,0,0,0.6))",
        }}
      />
    </div>

    {/* Tagline + Title */}
    <div style={{ textAlign: "center", position: "relative", zIndex: 3 }}>
      <div style={styles.heroTagline}>No hype, no bling, no burn</div>
      <h1 style={{ ...styles.heroTitle, marginBottom: 10 }}>
        Scan Your<br />
        <span style={{ color: COLORS.accent }}>Dragonfly</span>
      </h1>
      <p style={styles.heroSub}>
        Point your camera at any Dragonfly product to discover strain details, genetics, and lineage.
      </p>
    </div>

    {/* CTAs */}
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, width: "100%", maxWidth: 340, position: "relative", zIndex: 3 }}>
      <button
        style={{ ...styles.scanBtn, width: "100%" }}
        onClick={() => { setScreen("scan"); startCamera(); }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" />
          <path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
          <line x1="7" y1="12" x2="17" y2="12" />
        </svg>
        Scan Product
      </button>
      <button style={{ ...styles.browseBtn, width: "100%", marginTop: 0 }} onClick={() => setShowSearch(true)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
        </svg>
        Browse All Strains
      </button>
    </div>
  </div>

  {/* Feature strip */}
  <div style={styles.featureGrid}>
    <div style={styles.featureCard}>
      <div style={styles.featureIcon}>ð§¬</div>
      <div style={styles.featureLabel}>Genetics</div>
    </div>
    <div style={styles.featureCard}>
      <div style={styles.featureIcon}>ð¿</div>
      <div style={styles.featureLabel}>Terpenes</div>
    </div>
    <div style={styles.featureCard}>
      <div style={styles.featureIcon}>â¡</div>
      <div style={styles.featureLabel}>Effects</div>
    </div>
  </div>
</>
```

);

// âââ Render: Scan ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const renderScan = () => (
<div style={styles.scanContainer}>
<button style={styles.backBtn} onClick={goHome}>
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
<path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
</svg>
Back
</button>

```
  <div style={styles.videoWrapper}>
    {!cameraError && <video ref={videoRef} style={styles.video} muted playsInline />}
    {cameraError && !scanning && (
      <div style={{ ...styles.scanOverlay, background: COLORS.bgCard, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }}>
        <div style={{ fontSize: 48 }}>ð·</div>
        <div style={{ fontFamily: FONTS.display, fontSize: 15, fontWeight: 500, color: COLORS.textMuted, textAlign: "center", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Use the photo button below
        </div>
      </div>
    )}
    {!cameraError && !scanning && (
      <div style={styles.scanOverlay}>
        <div style={styles.scanFrame} />
      </div>
    )}
    {scanning && (
      <div style={{ ...styles.scanOverlay, background: "rgba(0,0,0,0.6)" }}>
        <div style={{ textAlign: "center", padding: "0 20px" }}>
          <div style={{ fontFamily: FONTS.display, fontSize: 16, fontWeight: 600, color: COLORS.accent, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
            {scanStatus || "Analyzing Product..."}
          </div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.textMuted }}>
            {Math.min(Math.round(scanProgress), 100)}%
          </div>
        </div>
      </div>
    )}
  </div>

  {scanning && (
    <div style={styles.progressBar}>
      <div style={styles.progressFill(scanProgress)} />
    </div>
  )}

  {!scanning && (
    <>
      <button
        style={{ ...styles.scanBtn, width: "100%", maxWidth: 400, justifyContent: "center" }}
        onClick={() => identifyWithVision("camera")}
        disabled={!!cameraError}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v4m0 12v4M2 12h4m12 0h4" />
        </svg>
        Capture &amp; Identify
      </button>
    </>
  )}

  {cameraError && !scanning && (
    <div style={{ width: "100%", maxWidth: 400, padding: "12px 16px", background: "rgba(200,255,0,0.08)", border: `1px solid ${COLORS.accent}40`, borderRadius: 10, marginBottom: 8, marginTop: 8, textAlign: "center" }}>
      <div style={{ fontSize: 14, color: COLORS.accent, fontWeight: 500 }}>{cameraError}</div>
    </div>
  )}

  {/* Upload and search buttons â ALWAYS visible, even during scanning */}
  <div style={{ width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginTop: scanning ? 8 : 0 }}>
    <div style={styles.orDivider}>
      <div style={styles.dividerLine} />
      <span>or</span>
      <div style={styles.dividerLine} />
    </div>

    <button 
      style={{ ...styles.uploadBtn, background: cameraError ? COLORS.accent : COLORS.bgCard, color: cameraError ? "#000" : COLORS.textMuted, fontWeight: 600, borderStyle: "solid", borderColor: cameraError ? COLORS.accent : COLORS.borderLight, width: "100%", fontSize: 15, padding: "14px 20px" }} 
      onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
      disabled={scanning}
    >
      ð· Take Photo or Upload
    </button>
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      capture="environment"
      style={{ display: "none" }}
      onChange={handleFileUpload}
    />

    <button
      style={{ ...styles.browseBtn, marginTop: 4 }}
      onClick={() => setShowSearch(true)}
      disabled={scanning}
    >
      Or search by strain name
    </button>
  </div>
</div>
```

);

// âââ Render: Pick Product Type âââââââââââââââââââââââââââââââââââââââââ
const productTypes = [
âPreroll 1gâ,
âInfused Preroll 1.25gâ,
âFlower 3.5gâ,
âVape Cart 1gâ,
âAIO Vape 1gâ,
âPremium Disposable Vaporizerâ,
â14 Pack Prerollsâ,
â1oz Premium Flowerâ,
âGummiesâ,
];

const renderPickProduct = () => {
if (!scannedStrain) return null;
const s = STRAIN_DB[scannedStrain];
if (!s) return null;

```
return (
  <div style={{ ...styles.resultContainer, paddingTop: 24 }}>
    <div style={{ textAlign: "center", marginBottom: 24 }}>
      {s.image && (
        <div style={{ width: 100, height: 100, margin: "0 auto 12px", borderRadius: 12, overflow: "hidden", background: COLORS.bgCard, border: `1px solid ${COLORS.borderLight}` }}>
          <img src={s.image} alt={scannedStrain} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { e.target.style.display = "none"; }} />
        </div>
      )}
      <div style={{ fontFamily: FONTS.display, fontSize: 14, fontWeight: 500, color: COLORS.accent, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Strain Identified</div>
      <h2 style={{ fontFamily: FONTS.display, fontSize: 28, fontWeight: 700, color: COLORS.textPrimary, margin: "0 0 8px" }}>{scannedStrain}</h2>
      <div style={{ fontFamily: FONTS.body, fontSize: 15, color: COLORS.textMuted }}>What product type is this?</div>
    </div>
    
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 400 }}>
      {productTypes.map(pt => (
        <button
          key={pt}
          style={{
            width: "100%",
            padding: "14px 16px",
            background: COLORS.bgCard,
            border: `1px solid ${COLORS.borderLight}`,
            borderRadius: 10,
            color: COLORS.textPrimary,
            fontFamily: FONTS.body,
            fontSize: 15,
            fontWeight: 500,
            cursor: "pointer",
            textAlign: "left",
            transition: "all 0.15s ease",
          }}
          onClick={() => {
            setScannedProduct(pt);
            setScreen("result");
          }}
          onMouseOver={(e) => { e.target.style.borderColor = COLORS.accent; e.target.style.background = `${COLORS.accent}10`; }}
          onMouseOut={(e) => { e.target.style.borderColor = COLORS.borderLight; e.target.style.background = COLORS.bgCard; }}
        >
          {pt}
        </button>
      ))}
    </div>

    <button style={{ ...styles.browseBtn, marginTop: 16 }} onClick={goHome}>
      Cancel
    </button>
  </div>
);
```

};

// âââ Render: Result ââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const renderResult = () => {
if (!scannedStrain || !STRAIN_DB[scannedStrain]) return null;
const s = STRAIN_DB[scannedStrain];
const tc = typeColor(s.type);

```
return (
  <div style={styles.resultContainer}>
    <button style={{ ...styles.backBtn, marginTop: 16 }} onClick={goHome}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
      </svg>
      Scan Another
    </button>

    <div style={styles.strainHeader}>
      {s.image && (
        <div style={{ width: 120, height: 120, margin: "0 auto 12px", borderRadius: 12, overflow: "hidden", background: COLORS.bgCard, border: `1px solid ${COLORS.borderLight}` }}>
          <img src={s.image} alt={scannedStrain} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { e.target.style.display = "none"; }} />
        </div>
      )}
      <div style={styles.typeBadge(tc)}>{s.type}</div>
      <h1 style={styles.strainName}>{scannedStrain}</h1>
      <div style={styles.strainCategory}>{scannedProduct || s.category} Â· THC {s.thc}</div>
    </div>

    {/* Quick Stats */}
    <div style={styles.infoSection}>
      <div style={styles.sectionTitle}>Quick Stats</div>
      <div style={styles.statGrid}>
        <div style={styles.statItem}>
          <div style={styles.statLabel}>Type</div>
          <div style={{ ...styles.statValue, color: tc }}>{s.type}</div>
        </div>
        <div style={styles.statItem}>
          <div style={styles.statLabel}>THC</div>
          <div style={styles.statValue}>{s.thc}</div>
        </div>
        <div style={styles.statItem}>
          <div style={styles.statLabel}>Flavor</div>
          <div style={{ ...styles.statValue, fontSize: 12 }}>{s.flavor}</div>
        </div>
        <div style={styles.statItem}>
          <div style={styles.statLabel}>Effects</div>
          <div style={{ ...styles.statValue, fontSize: 12 }}>{s.effects}</div>
        </div>
      </div>
    </div>

    {/* Genetics */}
    <div style={styles.infoSection}>
      <div style={styles.sectionTitle}>Genetics &amp; Lineage</div>
      <div style={styles.geneticsBox}>
        <div style={styles.geneticsLabel}>Cross</div>
        <div style={styles.geneticsValue}>{s.genetics}</div>
      </div>
      <div style={styles.geneticsBox}>
        <div style={styles.geneticsLabel}>Full Lineage</div>
        <div style={styles.lineageText}>{s.lineage}</div>
      </div>
    </div>

    {/* Terpenes */}
    <div style={styles.infoSection}>
      <div style={styles.sectionTitle}>Terpene Profile</div>
      <div>
        {s.terpenes.split(", ").map(t => (
          <span key={t} style={styles.terpTag}>{t}</span>
        ))}
      </div>
    </div>

    {/* Description */}
    <div style={styles.infoSection}>
      <div style={styles.sectionTitle}>About This Strain</div>
      <p style={styles.descText}>{s.description}</p>
    </div>

    {/* CTA */}
    <div style={styles.ctaSection}>
      <h3 style={styles.ctaTitle}>Want Deals on This Strain?</h3>
      <p style={styles.ctaText}>
        Sign up for exclusive discounts, early access drops, and Dragonfly rewards.
      </p>
      <button style={styles.ctaBtn} onClick={() => setScreen("signup")}>
        Join the Hive â
      </button>
    </div>
  </div>
);
```

};

// âââ Render: Signup ââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const renderSignup = () => {
const canSubmit = signupData.name && signupData.email && signupData.age;
return (
<div style={styles.formContainer}>
<button style={styles.backBtn} onClick={() => setScreen(scannedStrain ? âresultâ : âhomeâ)}>
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
<path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
</svg>
Back
</button>

```
    <div style={{ padding: "24px 0 0", textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>ð</div>
      <h2 style={styles.formTitle}>Join the Hive</h2>
      <p style={styles.formSub}>Get exclusive deals, early drops, and rewards from Dragonfly.</p>
    </div>

    <div style={styles.inputGroup}>
      <label style={styles.inputLabel}>Full Name</label>
      <input
        style={styles.input}
        placeholder="Your name"
        value={signupData.name}
        onChange={e => setSignupData({ ...signupData, name: e.target.value })}
      />
    </div>
    <div style={styles.inputGroup}>
      <label style={styles.inputLabel}>Email</label>
      <input
        style={styles.input}
        type="email"
        placeholder="you@email.com"
        value={signupData.email}
        onChange={e => setSignupData({ ...signupData, email: e.target.value })}
      />
    </div>
    <div style={styles.inputGroup}>
      <label style={styles.inputLabel}>Phone (optional)</label>
      <input
        style={styles.input}
        type="tel"
        placeholder="(555) 555-5555"
        value={signupData.phone}
        onChange={e => setSignupData({ ...signupData, phone: e.target.value })}
      />
    </div>

    <div style={styles.checkboxRow}>
      <input
        type="checkbox"
        style={styles.checkbox}
        checked={signupData.age}
        onChange={e => setSignupData({ ...signupData, age: e.target.checked })}
      />
      <label style={styles.checkboxLabel}>
        I confirm I am 21 years of age or older and agree to receive promotional communications from Dragonfly.
      </label>
    </div>

    <button
      style={{ ...styles.submitBtn, ...((canSubmit && !submitting) ? {} : styles.submitBtnDisabled) }}
      disabled={!canSubmit || submitting}
      onClick={async () => {
        setSubmitting(true);
        setSubmitError(null);
        try {
          const res = await fetch("/api/signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: signupData.name,
              email: signupData.email,
              phone: signupData.phone || null,
              strain: scannedStrain || null,
            }),
          });
          const data = await res.json();
          if (data.success) {
            setScreen("thanks");
            setSignupData({ name: "", email: "", phone: "", age: false });
          } else {
            setSubmitError(data.error || "Something went wrong. Please try again.");
          }
        } catch (err) {
          setSubmitError("Couldn't connect to server. Please try again.");
        } finally {
          setSubmitting(false);
        }
      }}
    >
      {submitting ? "Submitting..." : "Sign Me Up"}
    </button>
    {submitError && (
      <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, color: "#ef4444", fontSize: 13, textAlign: "center" }}>
        {submitError}
      </div>
    )}
  </div>
);
```

};

// âââ Render: Thanks ââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const renderThanks = () => (
<div style={styles.thanksContainer}>
<div style={styles.thanksIcon}>â</div>
<h2 style={styles.thanksTitle}>Youâre In</h2>
<p style={styles.thanksText}>
Welcome to the Dragonfly Hive. Watch your inbox for exclusive deals, new strain drops, and rewards.
</p>
<button style={styles.scanBtn} onClick={goHome}>
Scan Another Product
</button>
</div>
);

// âââ Main Render âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
return (
<div style={styles.app}>
<style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } } @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } } * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; } html { overflow-y: scroll; -webkit-overflow-scrolling: touch; } input:focus { border-color: ${COLORS.accent} !important; outline: none; } button { -webkit-tap-highlight-color: transparent; touch-action: manipulation; } button:active { transform: scale(0.97); opacity: 0.85; } select, textarea, input { font-size: 16px; } /* Prevent iOS zoom */ ::-webkit-scrollbar { width: 0; display: none; } /* Disable pull-to-refresh on mobile */ body { overscroll-behavior-y: contain; }`}</style>

```
  {/* Header */}
  <header style={styles.header}>
    <div style={styles.logo} onClick={goHome}>
      Dragon<span style={styles.logoAccent}>fly</span>
    </div>
    <div style={{ display: "flex", gap: 8 }}>
      <button style={styles.navBtn} onClick={() => setShowSearch(true)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: "middle", marginRight: 4 }}>
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
        </svg>
        Search
      </button>
      <button style={{ ...styles.navBtn, background: COLORS.accent, color: "#000", border: "none", fontWeight: 600 }} onClick={() => setScreen("signup")}>
        Join
      </button>
    </div>
  </header>

  {/* Screens */}
  {screen === "home" && renderHome()}
  {screen === "scan" && renderScan()}
  {screen === "pickProduct" && renderPickProduct()}
  {screen === "result" && renderResult()}
  {screen === "signup" && renderSignup()}
  {screen === "thanks" && renderThanks()}

  {/* Footer */}
  <footer style={styles.footer}>
    <div style={styles.footerText}>
      DRAGONFLY Â· NEW YORK Â· MICHIGAN<br />
      No hype, no bling, no burn. Just real good weed.<br />
      <span style={{ color: COLORS.textDim }}>Â© 2026 Dragonfly Brand. 21+ only.</span>
    </div>
  </footer>

  {/* Search Overlay */}
  {renderSearch()}
</div>
```

);
}