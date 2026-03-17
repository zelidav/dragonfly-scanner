import { useState, useEffect, useRef, useCallback } from "react";

// ─── OCR: Tesseract.js (loaded from CDN) ───────────────────────────────────
const loadTesseract = (() => {
  let promise = null;
  return () => {
    if (promise) return promise;
    promise = new Promise((resolve, reject) => {
      if (window.Tesseract) { resolve(window.Tesseract); return; }
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      script.onload = () => resolve(window.Tesseract);
      script.onerror = () => reject(new Error("Failed to load Tesseract.js"));
      document.head.appendChild(script);
    });
    return promise;
  };
})();

// ─── Fuzzy strain matcher ──────────────────────────────────────────────────
const fuzzyMatch = (ocrText, strainNames) => {
  if (!ocrText) return null;
  const clean = ocrText.toLowerCase().replace(/[^a-z0-9\s#]/g, "").trim();
  const words = clean.split(/\s+/);
  
  // Direct exact match
  for (const name of strainNames) {
    if (clean.includes(name.toLowerCase())) return name;
  }
  
  // Score-based fuzzy match
  let bestMatch = null;
  let bestScore = 0;
  
  for (const name of strainNames) {
    const nameLower = name.toLowerCase();
    const nameWords = nameLower.split(/\s+/);
    let score = 0;
    
    // Check if each word of the strain name appears in OCR text
    for (const nw of nameWords) {
      if (clean.includes(nw)) score += 3;
      else {
        // Levenshtein-like partial match
        for (const ow of words) {
          if (ow.length < 3) continue;
          if (nw.includes(ow) || ow.includes(nw)) { score += 2; break; }
          // Check edit distance for close matches
          let matches = 0;
          const shorter = Math.min(nw.length, ow.length);
          for (let i = 0; i < shorter; i++) { if (nw[i] === ow[i]) matches++; }
          if (matches / shorter > 0.7) { score += 1; break; }
        }
      }
    }
    
    // Bonus for matching word count
    if (nameWords.length === 1 && words.some(w => w === nameLower)) score += 5;
    
    // Normalize by name length
    const normalized = score / nameWords.length;
    if (normalized > bestScore && normalized >= 1.5) {
      bestScore = normalized;
      bestMatch = name;
    }
  }
  
  return bestMatch;
};

// ─── Dragonfly Strain Database ─────────────────────────────────────────────
const STRAIN_DB = {
  // Prerolls
  "Honey Banana": { type: "Hybrid", thc: "24-28%", genetics: "Honey Boo Boo × Banana OG", lineage: "Granddaddy Purple × Bukake → Honey Boo Boo | Banana Kush × OG Kush → Banana OG", flavor: "Sweet honey, ripe banana, tropical fruit", effects: "Euphoric, relaxed, creative", terpenes: "Myrcene, Limonene, Caryophyllene", description: "A smooth hybrid that wraps you in sweetness. The Honey Boo Boo parentage brings deep relaxation while Banana OG adds uplifting euphoria.", category: "Preroll 1g" },
  "Ice Cream Cookies": { type: "Indica", thc: "26-30%", genetics: "Ice Cream Cake × Girl Scout Cookies", lineage: "Gelato 33 × Wedding Cake → Ice Cream Cake | OG Kush × Durban Poison → GSC", flavor: "Creamy vanilla, sweet dough, earthy", effects: "Sedating, happy, relaxed", terpenes: "Limonene, Caryophyllene, Linalool", description: "A dessert-forward indica that hits like a warm blanket. The Gelato lineage brings creamy smoothness while GSC genetics deliver the punch.", category: "Preroll 1g" },
  "Jelly Donutz": { type: "Indica", thc: "25-29%", genetics: "Jelly Breath × Dosidos", lineage: "Mendo Breath × Do-Si-Dos → Jelly Breath | Face Off OG × OGKB → Dosidos", flavor: "Sweet berry jam, doughy, sugar glaze", effects: "Relaxed, sleepy, euphoric", terpenes: "Linalool, Myrcene, Limonene", description: "Named for its impossibly sweet, pastry-like flavor. The Mendo Breath genetics bring heavy body relaxation and a sweet, jammy exhale.", category: "Preroll 1g" },
  "Orange Creampop": { type: "Hybrid", thc: "22-26%", genetics: "Orange Cookies × Cookies & Cream", lineage: "Orange Juice × GSC → Orange Cookies | Starfighter × GSC → Cookies & Cream", flavor: "Citrus burst, vanilla cream, sweet orange", effects: "Uplifting, creative, relaxed", terpenes: "Limonene, Myrcene, Humulene", description: "Like biting into a frozen creamsicle on a summer day. The Orange Cookies parentage delivers bright citrus while the Cookies & Cream adds a creamy finish.", category: "Preroll 1g" },
  "Skittlez": { type: "Indica", thc: "24-28%", genetics: "Zkittlez (Grape Ape × Grapefruit)", lineage: "Mendocino Purps × Afghani → Grape Ape | Grapefruit (Cinderella 99 pheno)", flavor: "Tropical fruit medley, grape, berry", effects: "Calming, euphoric, focused", terpenes: "Caryophyllene, Linalool, Humulene", description: "The legendary Zkittlez delivers a rainbow of fruit flavors. Grape Ape brings the purple color and calm, while Grapefruit genetics add citrusy uplift.", category: "Preroll 1g" },
  "Triple Cake": { type: "Hybrid", thc: "26-30%", genetics: "Triangle Mints × Wedding Cake", lineage: "Triangle Kush × Animal Mints → Triangle Mints | Cherry Pie × GSC → Wedding Cake", flavor: "Sweet cake batter, mint, gas", effects: "Euphoric, relaxed, creative", terpenes: "Limonene, Caryophyllene, Myrcene", description: "Triple the cake, triple the hit. Triangle Mints brings minty gas while Wedding Cake adds layers of sweet, doughy flavor with potent effects.", category: "Preroll 1g" },
  "Afghan Kush": { type: "Indica", thc: "20-25%", genetics: "Landrace (Hindu Kush Mountains, Afghanistan)", lineage: "Pure landrace indica — one of cannabis' oldest cultivated strains, originating from the mountainous border of Afghanistan and Pakistan", flavor: "Earthy, woody, sweet hash", effects: "Deeply relaxing, sedating, stress relief", terpenes: "Myrcene, Pinene, Caryophyllene", description: "A pure landrace strain from the Hindu Kush mountain range. Thousands of years of natural selection created this bulletproof indica — the genetic backbone of countless modern hybrids.", category: "Preroll 1g" },
  "AK-47": { type: "Sativa", thc: "20-25%", genetics: "Colombian × Mexican × Thai × Afghan", lineage: "A complex sativa-dominant blend of South American, Mexican, Thai, and Afghani landraces — first crossed in 1992 by Serious Seeds in the Netherlands", flavor: "Earthy, floral, sweet, sour", effects: "Uplifting, creative, alert, social", terpenes: "Myrcene, Pinene, Caryophyllene", description: "Despite its intense name, AK-47 delivers a mellow, steady cerebral buzz. Four landrace genetics combine to create one of the most awarded strains in cannabis history.", category: "Preroll 1g" },
  "Blue Dream": { type: "Sativa", thc: "21-26%", genetics: "Blueberry × Haze", lineage: "Afghani × Thai × Purple Thai → Blueberry | Colombian Gold × Thai × Mexican × South Indian → Haze", flavor: "Sweet blueberry, vanilla, herbal", effects: "Balanced euphoria, gentle relaxation, creative", terpenes: "Myrcene, Pinene, Caryophyllene", description: "California's most iconic strain. The legendary DJ Short Blueberry brings sweet berry flavor while Haze genetics deliver soaring, clear-headed energy. The perfect balance.", category: "Preroll 1g" },
  "Cap Junky": { type: "Hybrid", thc: "28-33%", genetics: "Alien Cookies × Kush Mints #11", lineage: "GSC × Alien Dawg → Alien Cookies | Bubba Kush × Animal Mints → Kush Mints", flavor: "Minty gas, earthy funk, sweet cream", effects: "Potent euphoria, creative, relaxed", terpenes: "Limonene, Caryophyllene, Myrcene", description: "A top-shelf powerhouse crossing two cookie-family heavyweights. Alien Cookies brings the funk while Kush Mints adds a frosty, gassy edge. Extremely high THC.", category: "Preroll 1g" },
  "Chernobyl": { type: "Hybrid", thc: "22-26%", genetics: "Trainwreck × Jack the Ripper", lineage: "Mexican × Thai × Afghani → Trainwreck | Jack's Cleaner × Space Queen → Jack the Ripper", flavor: "Lime sherbet, tropical citrus, sweet", effects: "Energetic, uplifting, giggly", terpenes: "Terpinolene, Myrcene, Ocimene", description: "Created by TGA Subcool, Chernobyl is famous for its nuclear-green buds and radioactive lime flavor. Trainwreck provides the energy while Jack the Ripper adds a sweet citrus kick.", category: "Preroll 1g" },
  "Cookie Crush": { type: "Hybrid", thc: "25-29%", genetics: "GSC × OG Kush", lineage: "Durban Poison × OG Kush → GSC | Chemdawg × Hindu Kush → OG Kush", flavor: "Sweet cookies, earthy pine, vanilla", effects: "Euphoric, relaxed, happy", terpenes: "Caryophyllene, Limonene, Humulene", description: "A double dose of the Cookie family's best traits. Girl Scout Cookies brings the sweet, doughy flavor while OG Kush reinforces the potent, relaxing backbone.", category: "Preroll 1g" },
  "Death Star": { type: "Indica", thc: "24-28%", genetics: "Sensi Star × Sour Diesel", lineage: "Afghani indica hybrid → Sensi Star | Chemdawg × Mass Super Skunk × Northern Lights → Sour Diesel", flavor: "Diesel fuel, earthy, sweet skunk", effects: "Heavy relaxation, euphoric, sleepy", terpenes: "Myrcene, Caryophyllene, Limonene", description: "Named for its ability to destroy stress. Sensi Star brings the indica weight while Sour Diesel adds a sativa-leaning cerebral sparkle and pungent fuel aroma.", category: "Preroll 1g" },
  "Garlic Budder": { type: "Indica", thc: "26-30%", genetics: "GMO × Peanut Butter Breath", lineage: "Chemdawg × GSC → GMO (Garlic Mushroom Onion) | Do-Si-Dos × Mendo Breath → Peanut Butter Breath", flavor: "Garlic, savory, creamy, funky", effects: "Heavy body, relaxed, sedating", terpenes: "Caryophyllene, Myrcene, Limonene", description: "For the savory palate — GMO's unmistakable garlic funk meets the creamy, nutty smoothness of Peanut Butter Breath. One of the most unique flavor profiles in the game.", category: "Preroll 1g" },
  "GG#4": { type: "Hybrid", thc: "25-30%", genetics: "Chem's Sister × Sour Dubb × Chocolate Diesel", lineage: "Chemdawg sibling → Chem's Sister | Sour Diesel phenotype → Sour Dubb | Sour Diesel × Chocolate Trip → Chocolate Diesel", flavor: "Pine, earthy chocolate, diesel", effects: "Glued-to-couch, euphoric, relaxed", terpenes: "Caryophyllene, Myrcene, Limonene", description: "The legendary GG#4 (Gorilla Glue) — an accidental cross that became one of cannabis' most celebrated strains. Named for the resin that sticks to everything during trimming.", category: "Preroll 1g" },
  "Green Crack": { type: "Sativa", thc: "20-25%", genetics: "Skunk #1 × Unknown Indica (disputed Afghani)", lineage: "Originally named 'Cush' — renamed by Snoop Dogg for its energizing effects. Descended from Skunk #1 lineage with possible Sweet Leaf/Afghani genetics", flavor: "Citrus mango, tropical, sweet", effects: "Energetic, focused, uplifting", terpenes: "Myrcene, Pinene, Caryophyllene", description: "The ultimate wake-and-bake strain. Delivers a tangy, fruity flavor and sharp mental energy. Snoop renamed it for the intense, invigorating rush it delivers.", category: "Preroll 1g" },
  "Headband": { type: "Hybrid", thc: "24-28%", genetics: "OG Kush × Sour Diesel", lineage: "Chemdawg × Hindu Kush → OG Kush | Chemdawg × Mass Super Skunk × Northern Lights → Sour Diesel", flavor: "Creamy lemon, diesel, earthy", effects: "Cerebral pressure, relaxed, euphoric", terpenes: "Myrcene, Limonene, Caryophyllene", description: "Named for the subtle pressure you feel around your temples — like wearing an invisible headband. Two of cannabis' greatest strains combine for smooth, long-lasting effects.", category: "Preroll 1g" },
  "Jealousy": { type: "Hybrid", thc: "27-31%", genetics: "Gelato 41 × Sherbert", lineage: "Sunset Sherbet × Thin Mint GSC → Gelato 41 | GSC × Pink Panties → Sherbert", flavor: "Creamy gelato, candy, berry", effects: "Balanced, euphoric, creative, calm", terpenes: "Caryophyllene, Limonene, Linalool", description: "Bred by Seed Junky Genetics, Jealousy lives up to the hype. Dense, purple-tinted buds deliver a creamy, candy-like flavor and perfectly balanced effects.", category: "Preroll 1g" },
  "Jet Fuel Gelato": { type: "Hybrid", thc: "27-32%", genetics: "Jet Fuel × Gelato", lineage: "Aspen OG × High Country Diesel → Jet Fuel | Sunset Sherbet × Thin Mint GSC → Gelato", flavor: "Gas, sweet cream, diesel, berry", effects: "Potent euphoria, energetic, relaxed", terpenes: "Caryophyllene, Limonene, Myrcene", description: "High-octane meets creamy dessert. Jet Fuel brings the gas-forward punch while Gelato smooths it out with sweet, creamy undertones. A premium hybrid experience.", category: "Preroll 1g" },
  "Kush Mintz": { type: "Hybrid", thc: "27-32%", genetics: "Animal Mints × Bubba Kush", lineage: "Thin Mint GSC × Fire OG × Animal Cookies → Animal Mints | OG Kush × Afghani → Bubba Kush", flavor: "Minty, earthy, sweet, coffee", effects: "Relaxing, euphoric, calming", terpenes: "Limonene, Caryophyllene, Myrcene", description: "Seed Junky's masterpiece. The Animal Mints gives it that frosty mint flavor while Bubba Kush adds old-school body sedation. A modern classic with legendary parents.", category: "Preroll 1g" },
  "Lemon Pound Cake": { type: "Hybrid", thc: "23-27%", genetics: "Lemon Skunk × Cheese", lineage: "Lemon Joy × Skunk #1 → Lemon Skunk | Skunk #1 phenotype → Cheese", flavor: "Lemon zest, buttery cake, sweet cream", effects: "Uplifting, social, relaxed", terpenes: "Limonene, Caryophyllene, Humulene", description: "Exactly what it sounds like — a rich, buttery lemon cake flavor that coats the palate. The Lemon Skunk parentage provides zesty brightness while Cheese adds depth and body.", category: "Preroll 1g" },
  "Liberty Haze": { type: "Sativa", thc: "22-27%", genetics: "G13 × ChemDawg 91", lineage: "Government G13 (legendary Afghani indica) × ChemDawg 91 (Chemdawg phenotype) — bred by Barney's Farm, 2011 Cannabis Cup winner", flavor: "Sharp lime, earthy, chemical, sweet", effects: "Energetic, creative, cerebral", terpenes: "Terpinolene, Myrcene, Pinene", description: "A Cannabis Cup champion from Barney's Farm. The mythical G13 brings potency while ChemDawg 91 adds electric sativa energy. Named for the freedom it gives your mind.", category: "Preroll 1g" },
  "Northern Lights": { type: "Indica", thc: "20-24%", genetics: "Afghani × Thai", lineage: "Pure Afghani indica landrace × Thai sativa landrace — originally cultivated in Seattle, perfected by Sensi Seeds in the Netherlands in the 1980s", flavor: "Sweet earth, pine, honey", effects: "Full body relaxation, dreamy, sleepy", terpenes: "Myrcene, Pinene, Caryophyllene", description: "One of the most famous indicas ever created. Northern Lights has been a cornerstone of cannabis breeding since the 1980s — a two-time Cannabis Cup winner and parent to countless hybrids.", category: "Preroll 1g" },
  "NYC Diesel": { type: "Hybrid", thc: "21-25%", genetics: "Mexican Sativa × Afghani", lineage: "Soma Seeds creation — Mexican sativa landrace × Afghani indica with possible Sour Diesel influence. A New York City staple since the early 2000s", flavor: "Grapefruit diesel, lime, red berry", effects: "Cerebral, talkative, creative, happy", terpenes: "Limonene, Myrcene, Caryophyllene", description: "Born in the Big Apple. NYC Diesel captures the electric energy of the city in a joint — bright citrus and diesel fuel aroma with a creative, social buzz that keeps the conversation flowing.", category: "Preroll 1g" },
  "Skywalker OG": { type: "Indica", thc: "25-30%", genetics: "Skywalker × OG Kush", lineage: "Blueberry × Mazar I Sharif → Skywalker | Chemdawg × Hindu Kush → OG Kush", flavor: "Earthy pine, spicy, herbal", effects: "Heavy sedation, euphoric, tranquil", terpenes: "Myrcene, Caryophyllene, Limonene", description: "The force is strong with this one. Skywalker's Blueberry-Afghan heritage meets the unmatched potency of OG Kush for a deeply sedating experience that sends you to a galaxy far, far away.", category: "Preroll 1g" },
  "Sour Lemons": { type: "Sativa", thc: "22-26%", genetics: "Sour Diesel × Lemon OG", lineage: "Chemdawg × Mass Super Skunk × NL → Sour Diesel | Lemon Skunk × OG Kush → Lemon OG", flavor: "Sharp lemon, sour diesel, citrus peel", effects: "Energetic, focused, mood-boosting", terpenes: "Limonene, Pinene, Caryophyllene", description: "A citrus explosion that hits you right between the eyes. Sour Diesel's legendary energy gets a lemon-forward twist from Lemon OG. Perfect for daytime productivity.", category: "Preroll 1g" },
  "Space Candy": { type: "Sativa", thc: "20-24%", genetics: "Space Queen × Cotton Candy", lineage: "Romulan × Cinderella 99 → Space Queen | Lavender × Power Plant → Cotton Candy", flavor: "Sweet candy, floral, tropical citrus", effects: "Energetic, creative, happy", terpenes: "Myrcene, Terpinolene, Ocimene", description: "A whimsical sativa that tastes like a candy shop in outer space. Space Queen brings the cosmic energy while Cotton Candy adds layers of sweetness and floral complexity.", category: "Preroll 1g" },
  "Trainwreck": { type: "Sativa", thc: "22-27%", genetics: "Mexican × Thai × Afghani", lineage: "Mexican sativa × Thai sativa × Afghani indica — originated in Northern California's Emerald Triangle, named for its intense, fast-hitting effects", flavor: "Spicy pine, lemon, earthy pepper", effects: "Fast-hitting euphoria, creative, energetic", terpenes: "Terpinolene, Myrcene, Pinene", description: "A legendary NorCal strain that hits you like its name suggests. Three landrace genetics combine for a spicy, pine-forward sativa that delivers immediate cerebral stimulation.", category: "Preroll 1g" },
  "Wedding Cake": { type: "Hybrid", thc: "25-30%", genetics: "Cherry Pie × Girl Scout Cookies", lineage: "Granddaddy Purple × Durban Poison → Cherry Pie | OG Kush × Durban Poison → GSC", flavor: "Sweet vanilla frosting, tangy, earthy", effects: "Relaxed, euphoric, happy", terpenes: "Limonene, Caryophyllene, Myrcene", description: "Also known as Pink Cookies — a powerhouse that tastes like a slice of wedding cake. Cherry Pie brings fruity sweetness while GSC adds the beloved cookie dough flavor and balanced effects.", category: "Preroll 1g" },
  "White Fire OG": { type: "Hybrid", thc: "25-29%", genetics: "Fire OG × The White", lineage: "OG Kush × SFV OG → Fire OG | Unknown triangle cross → The White (famous for trichome production)", flavor: "Earthy, woody, pepper, diesel", effects: "Uplifting, relaxed, focused", terpenes: "Caryophyllene, Limonene, Myrcene", description: "WiFi OG — where Fire OG's intense potency meets The White's legendary frost. Known for snowcapped buds and a clean, peppery diesel flavor that cannabis connoisseurs chase.", category: "Preroll 1g" },
  "Zoap": { type: "Hybrid", thc: "26-30%", genetics: "Rainbow Sherbet × Pink Guava", lineage: "Champagne × Blackberry → Rainbow Sherbet | Unknown exotic cross → Pink Guava (Deep East Oakland genetics by Deo Farms)", flavor: "Soapy floral, fruity, sweet, berry", effects: "Balanced euphoria, creative, relaxed", terpenes: "Caryophyllene, Limonene, Linalool", description: "Bred by DEO Farms, Zoap took the cannabis world by storm. Its unique soapy-floral-fruit flavor is unlike anything else. Rainbow Sherbet brings color while Pink Guava adds exotic sweetness.", category: "Preroll 1g" },
  // Infused Prerolls
  "Banana Bash": { type: "Hybrid", thc: "35-40%+", genetics: "Banana Kush × Hindu Kush (Infused)", lineage: "Ghost OG × Skunk Haze → Banana Kush | Hindu Kush landrace — enhanced with live resin concentrate for amplified potency", flavor: "Banana cream, sweet tropical, earthy hash", effects: "Powerful euphoria, deeply relaxed, blissful", terpenes: "Myrcene, Limonene, Caryophyllene", description: "An infused powerhouse. The Banana Kush base delivers sweet tropical flavor, amplified with concentrate for an elevated experience. Not for beginners.", category: "Infused Preroll 1.25g" },
  "Blueberry Banana Waffles": { type: "Indica", thc: "35-40%+", genetics: "Blueberry × Banana OG (Infused)", lineage: "DJ Short's Blueberry (Afghani × Thai × Purple Thai) × Banana OG — infused with premium concentrate", flavor: "Blueberry pancakes, banana bread, maple", effects: "Sedating, euphoric, munchies", terpenes: "Myrcene, Limonene, Linalool", description: "Breakfast in a joint. DJ Short's legendary Blueberry meets Banana OG, then gets infused for maximum impact. The flavor literally tastes like blueberry banana waffles.", category: "Infused Preroll 1.25g" },
  "Just Peachy": { type: "Hybrid", thc: "35-40%+", genetics: "Georgia Pie × Peach Ringz (Infused)", lineage: "Gelatti × Kush Mints → Georgia Pie | Unknown exotic cross → Peach Ringz — enhanced with live resin", flavor: "Fresh peach, candy rings, sweet cream", effects: "Uplifting, euphoric, relaxed", terpenes: "Limonene, Myrcene, Caryophyllene", description: "Georgia Pie's candy-forward genetics meet Peach Ringz for a fruity experience that tastes exactly like the candy. Infusion pushes potency into the stratosphere.", category: "Infused Preroll 1.25g" },
  "Lychee Dream": { type: "Sativa", thc: "35-40%+", genetics: "Lychee × Dream (Infused)", lineage: "Exotic lychee-flavored cultivar crossed with dreamy sativa genetics — infused with premium concentrate for enhanced potency", flavor: "Sweet lychee fruit, floral, tropical", effects: "Creative, uplifting, dreamy euphoria", terpenes: "Terpinolene, Myrcene, Ocimene", description: "An exotic sativa-leaning infused preroll that captures the unmistakable sweetness of fresh lychee fruit. The infusion adds layers of potency while maintaining the delicate flavor profile.", category: "Infused Preroll 1.25g" },
  "Strawberry Kiwi": { type: "Hybrid", thc: "35-40%+", genetics: "Strawberry Cough × Kiwi Kush (Infused)", lineage: "Strawberry Fields × Haze → Strawberry Cough | Kiwi-flavored OG phenotype → Kiwi Kush — infused with concentrate", flavor: "Fresh strawberry, kiwi tang, sweet berry", effects: "Happy, social, relaxed", terpenes: "Myrcene, Limonene, Pinene", description: "The classic juice box flavor in an infused joint. Strawberry Cough's legendary berry flavor gets a tropical twist from Kiwi Kush, then concentrated infusion takes it next level.", category: "Infused Preroll 1.25g" },
  "Watermelon Skittlez": { type: "Indica", thc: "35-40%+", genetics: "Watermelon Zkittlez × Zkittlez (Infused)", lineage: "Watermelon phenotype × Zkittlez (Grape Ape × Grapefruit) — infused with premium live resin concentrate", flavor: "Juicy watermelon, candy, tropical fruit", effects: "Deeply relaxing, euphoric, sleepy", terpenes: "Myrcene, Caryophyllene, Limonene", description: "Summer in an infused preroll. The Watermelon phenotype brings juicy, refreshing flavor while Zkittlez adds that famous rainbow fruit candy sweetness. Infusion makes it a heavy hitter.", category: "Infused Preroll 1.25g" },
  // Flower
  "Chem 91": { type: "Sativa", thc: "24-28%", genetics: "Chemdawg 91 (Original Chemdog cut)", lineage: "One of the original Chemdawg cuts — secured at a Grateful Dead concert in 1991. The genetic ancestor of OG Kush, Sour Diesel, and countless modern strains", flavor: "Sharp chemical, diesel, pine, funk", effects: "Cerebral, creative, focused, uplifting", terpenes: "Caryophyllene, Myrcene, Limonene", description: "Cannabis royalty. Chem 91 is THE original Chemdog cut from the Grateful Dead era — the genetic foundation that birthed OG Kush and Sour Diesel. Pure East Coast history in every nug.", category: "Flower 3.5g" },
  "Banana Cream Pie": { type: "Indica", thc: "24-28%", genetics: "Banana OG × Cookies & Cream", lineage: "Banana Kush × OG Kush → Banana OG | Starfighter × GSC → Cookies & Cream", flavor: "Banana cream, vanilla custard, sweet dough", effects: "Relaxed, euphoric, sleepy, happy", terpenes: "Myrcene, Limonene, Caryophyllene", description: "Dessert genetics at their finest. Banana OG's tropical sweetness meets Cookies & Cream's rich vanilla. Like eating a banana cream pie that melts every muscle in your body.", category: "Flower 3.5g" },
  "Black Maple": { type: "Indica", thc: "25-29%", genetics: "Black Diamond × Maple Leaf Indica", lineage: "Blackberry × Diamond OG → Black Diamond | Afghani landrace selection → Maple Leaf Indica (Sensi Seeds)", flavor: "Dark maple syrup, earthy, sweet berry", effects: "Deep relaxation, sedating, pain relief", terpenes: "Myrcene, Caryophyllene, Humulene", description: "A dark, mysterious indica that pours like liquid maple. Black Diamond's purple, berry-forward profile meets Maple Leaf's old-school Afghani warmth for a nighttime knockout.", category: "Flower 3.5g" },
  "Candy Fumez": { type: "Hybrid", thc: "26-30%", genetics: "Candy Rain × Sherbinski Grapefruit", lineage: "London Pound Cake × Gushers → Candy Rain | Sherbinski's Grapefruit phenotype selection", flavor: "Sweet candy, grapefruit, gasoline", effects: "Euphoric, creative, relaxed, social", terpenes: "Limonene, Caryophyllene, Myrcene", description: "A candy store meets a gas station in the best way possible. The London Pound Cake lineage in Candy Rain brings sweetness while Grapefruit adds a bright citrus-gas contrast.", category: "Flower 3.5g" },
  "Carbon Fiber": { type: "Hybrid", thc: "27-31%", genetics: "Grape Pie × Biscotti", lineage: "Cherry Pie × Grape Stomper → Grape Pie | Gelato 25 × South Florida OG → Biscotti", flavor: "Fruity, nutty, earthy, grape", effects: "Balanced, creative, calm focus", terpenes: "Caryophyllene, Limonene, Humulene", description: "Sleek, potent, and engineered for performance — just like its namesake material. Grape Pie brings the fruity density while Biscotti adds toasted, nutty complexity.", category: "Flower 3.5g" },
  "Dulce De Uva": { type: "Indica", thc: "25-29%", genetics: "Grape Cream Cake × Dulce", lineage: "Grape-dominant exotic phenotype × Dulce (sweet Latin-inspired cultivar)", flavor: "Grape jam, caramel, sweet cream", effects: "Relaxed, happy, dreamy, sweet", terpenes: "Myrcene, Linalool, Caryophyllene", description: "The name says it all — 'Grape Sweetness' in Spanish. Rich grape jam flavor with caramel undertones. An indica that wraps you in a warm, dreamy sweetness.", category: "Flower 3.5g" },
  "GSC": { type: "Hybrid", thc: "25-29%", genetics: "OG Kush × Durban Poison", lineage: "Chemdawg × Hindu Kush → OG Kush | South African sativa landrace → Durban Poison — originally bred by the Cookie Family in San Francisco", flavor: "Sweet cookie dough, earthy, mint", effects: "Euphoric, creative, full-body relaxed", terpenes: "Caryophyllene, Limonene, Humulene", description: "Girl Scout Cookies — the strain that launched a thousand crosses. Born in San Francisco, GSC changed cannabis forever. OG Kush's potency meets Durban Poison's euphoric energy.", category: "Flower 3.5g" },
  "Jelly Donut": { type: "Indica", thc: "25-29%", genetics: "Jelly Breath × Dosidos", lineage: "Mendo Breath × Do-Si-Dos → Jelly Breath | Face Off OG × OGKB → Dosidos", flavor: "Sweet berry jam, doughy, sugar glaze", effects: "Relaxed, sleepy, euphoric", terpenes: "Linalool, Myrcene, Limonene", description: "The flower version of the preroll favorite. Dense, purple buds that smell exactly like a fresh jelly donut. Mendo Breath genetics bring heavy relaxation with a sweet, jammy finish.", category: "Flower 3.5g" },
  "Lemon Cherry Gelato": { type: "Hybrid", thc: "26-30%", genetics: "Sunset Sherbet × Girl Scout Cookies × (Lemon × Cherry)", lineage: "Part of the Gelato family — Sunset Sherbet × Thin Mint GSC base with lemon and cherry phenotype expression selected by Backpackboyz", flavor: "Lemon zest, cherry candy, creamy gelato", effects: "Uplifting, creative, relaxed, social", terpenes: "Limonene, Caryophyllene, Linalool", description: "The most hyped Gelato phenotype in recent years. Bright lemon and cherry flavors shine through a creamy gelato base. The buds are dense, purple, and absolutely caked in trichomes.", category: "Flower 3.5g" },
  "Nascar": { type: "Sativa", thc: "24-28%", genetics: "GMO × Trophy Wife", lineage: "Chemdawg × GSC → GMO | Unknown high-octane sativa cross → Trophy Wife", flavor: "Gassy, garlic, spicy, chemical", effects: "Fast-hitting energy, focused, creative", terpenes: "Caryophyllene, Myrcene, Limonene", description: "Pedal to the metal. Nascar takes GMO's pungent garlic gas and adds Trophy Wife's racing sativa energy. Named for the speed at which the effects hit you — full throttle from the first pull.", category: "Flower 3.5g" },
  "Pinnacle": { type: "Hybrid", thc: "27-31%", genetics: "Runtz × Gelato", lineage: "Zkittlez × Gelato → Runtz | Sunset Sherbet × Thin Mint GSC → Gelato", flavor: "Sweet candy, creamy, tropical fruit", effects: "Peak euphoria, balanced, creative", terpenes: "Limonene, Caryophyllene, Linalool", description: "The name says it all — this is the peak. Runtz's candy sweetness meets Gelato's creamy smoothness. Dense, colorful buds deliver what might be the most enjoyable smoke in the Dragonfly lineup.", category: "Flower 3.5g" },
  // 1oz
  "Creme De Menthe": { type: "Hybrid", thc: "24-28%", genetics: "Kush Mints × Gelato", lineage: "Animal Mints × Bubba Kush → Kush Mints | Sunset Sherbet × Thin Mint GSC → Gelato", flavor: "Cool mint, cream, sweet chocolate", effects: "Relaxed, uplifting, minty fresh", terpenes: "Limonene, Caryophyllene, Myrcene", description: "An after-dinner mint in flower form. Kush Mints brings the cool minty frost while Gelato adds creamy sweetness. Premium full ounce for the true connoisseur.", category: "1oz Premium Flower" },
  "Frost": { type: "Hybrid", thc: "26-30%", genetics: "Ice Cap × White Truffle", lineage: "Frozen Gelato × Ice Cream Cake → Ice Cap | Gorilla Butter phenotype → White Truffle", flavor: "Icy menthol, creamy, earthy, sweet", effects: "Cool euphoria, balanced, relaxed", terpenes: "Caryophyllene, Limonene, Myrcene", description: "Named for the blanket of trichomes that makes every nug look frozen. Ice Cap's icy gelato genetics meet White Truffle's rare, creamy funk. Premium quality at scale.", category: "1oz Premium Flower" },
  "HDG": { type: "Indica", thc: "25-29%", genetics: "Heavy Duty Genetics cross", lineage: "Heavy-hitting indica genetics — bred for maximum potency, density, and resin production", flavor: "Gas, earthy, sweet, pungent", effects: "Potent, sedating, full-body relaxation", terpenes: "Myrcene, Caryophyllene, Humulene", description: "HDG — Heavy Duty hits different. Bred for people who need the strongest indica in the room. Dense, frosty nugs that deliver uncompromising relaxation in a full ounce.", category: "1oz Premium Flower" },
  "Wedding Crasher": { type: "Hybrid", thc: "25-29%", genetics: "Wedding Cake × Purple Punch", lineage: "Cherry Pie × GSC → Wedding Cake | Larry OG × Granddaddy Purple → Purple Punch", flavor: "Sweet vanilla, grape candy, creamy cake", effects: "Social, euphoric, relaxed, creative", terpenes: "Limonene, Caryophyllene, Myrcene", description: "Crashing the party with style. Wedding Cake's sweet vanilla meets Purple Punch's grape candy for an irresistible combination. The life of every smoke session.", category: "1oz Premium Flower" },
  // Vapes (All-In-One + Carts) - flavor/effect focused
  "Blue Razz": { type: "Sativa", thc: "85-90%", genetics: "Blue Raspberry terpene profile (Blue Dream lineage)", lineage: "Blueberry × Haze inspired terpene blend — blue raspberry candy flavor engineered from natural cannabis terpenes", flavor: "Blue raspberry candy, sweet berry, tart", effects: "Energetic, uplifting, happy", terpenes: "Myrcene, Pinene, Limonene", description: "The blue raspberry experience perfected for vape. Inspired by Blue Dream genetics, this captures the iconic candy shop flavor with a bright, energizing sativa buzz.", category: "Vape" },
  "Double Bubble OG": { type: "Indica", thc: "85-90%", genetics: "Bubble Gum × OG Kush", lineage: "Indiana Bubble Gum × OG Kush — old-school bubblegum genetics meet modern OG potency", flavor: "Classic bubblegum, sweet, earthy OG", effects: "Relaxed, nostalgic, happy", terpenes: "Myrcene, Caryophyllene, Limonene", description: "That classic bubblegum flavor from the bag you used to get at the corner store — now in a vape. Indiana Bubble Gum genetics meet OG Kush's legendary relaxation.", category: "Vape" },
  "Electric Watermelon OG": { type: "Hybrid", thc: "85-90%", genetics: "Watermelon × OG Kush", lineage: "Watermelon phenotype × OG Kush — electrified watermelon flavor with classic OG backbone", flavor: "Sweet watermelon, electric citrus, earthy OG", effects: "Balanced, uplifting, relaxed", terpenes: "Limonene, Myrcene, Caryophyllene", description: "Watermelon that hits you with a jolt. The watermelon phenotype's juicy sweetness gets an OG Kush backbone for balance. Like biting into a watermelon that bites back.", category: "Vape" },
  "Forbidden Fruit": { type: "Indica", thc: "85-90%", genetics: "Cherry Pie × Tangie", lineage: "Granddaddy Purple × Durban Poison → Cherry Pie | California Orange × Skunk → Tangie", flavor: "Tropical passionfruit, cherry, mango", effects: "Deeply relaxing, exotic, dreamy", terpenes: "Myrcene, Limonene, Pinene", description: "The most exotic fruit salad you'll ever taste. Cherry Pie's berry sweetness meets Tangie's tropical citrus for a flavor so good it feels like it shouldn't be allowed.", category: "Vape" },
  "Lemon Drop": { type: "Sativa", thc: "85-90%", genetics: "Lemon OG × Sour Diesel", lineage: "Lemon Skunk × OG Kush → Lemon OG | Chemdawg × MSSS × NL → Sour Diesel", flavor: "Sharp lemon candy, sour, sweet citrus", effects: "Energizing, focused, mood-boosting", terpenes: "Limonene, Pinene, Caryophyllene", description: "Pure lemon candy energy in a vape. Lemon OG brings the citrus bomb while Sour Diesel adds sativa fuel. Like squeezing a lemon straight into your brain — in a good way.", category: "Vape" },
  "Rainbow Beltz": { type: "Hybrid", thc: "85-90%", genetics: "Zkittlez × Moonbow", lineage: "Grape Ape × Grapefruit → Zkittlez | Zkittlez × Do-Si-Dos → Moonbow", flavor: "Sour rainbow candy, fruity, sweet-tart", effects: "Euphoric, creative, balanced", terpenes: "Caryophyllene, Limonene, Myrcene", description: "Tastes exactly like the sour candy belt. Zkittlez appears on both sides of the lineage for double the fruit, while Moonbow adds exotic complexity. A candy lover's dream.", category: "Vape" },
  "Red Razzleberry": { type: "Sativa", thc: "85-90%", genetics: "Raspberry Kush × Berry White", lineage: "Raspberry-forward phenotype selection × White Widow × Blueberry → Berry White", flavor: "Red raspberry, mixed berry, sweet tart", effects: "Uplifting, social, creative", terpenes: "Myrcene, Limonene, Pinene", description: "Red berry explosion. The raspberry phenotype delivers intense, authentic berry flavor while Berry White adds smooth, creamy sweetness. A fruit-forward sativa you'll keep hitting.", category: "Vape" },
  "Green Apple": { type: "Sativa", thc: "85-90%", genetics: "Green Apple Runtz (Zkittlez × Gelato)", lineage: "Green apple phenotype of Runtz — Zkittlez × Gelato with selected green apple terpene expression", flavor: "Sour green apple, candy, tart citrus", effects: "Energetic, focused, euphoric", terpenes: "Limonene, Pinene, Terpinolene", description: "Sour green apple candy in a cart. This Runtz phenotype was selected specifically for its bright, tart apple flavor. Sativa energy with candy shop appeal.", category: "Vape" },
  "Orange Creamsicle": { type: "Hybrid", thc: "85-90%", genetics: "Orange Crush × Juicy Fruit", lineage: "California Orange × Blueberry → Orange Crush | Afghani × Thai → Juicy Fruit", flavor: "Creamy orange, vanilla ice cream, tangy", effects: "Uplifting, relaxed, nostalgic", terpenes: "Limonene, Myrcene, Linalool", description: "The ice cream truck in a cart. Orange Crush's bright citrus meets Juicy Fruit's tropical sweetness for a creamy, dreamy vape that tastes like summer childhood.", category: "Vape" },
  "Papaya Punch": { type: "Indica", thc: "85-90%", genetics: "Papaya × Purple Punch", lineage: "Citral #13 × Ice #2 → Papaya | Larry OG × Granddaddy Purple → Purple Punch", flavor: "Tropical papaya, grape punch, sweet cream", effects: "Relaxing, tropical, sleepy", terpenes: "Myrcene, Limonene, Caryophyllene", description: "A tropical knockout. Papaya's exotic fruit sweetness gets amped up with Purple Punch's grape candy power. Close your eyes and you're on a hammock somewhere warm.", category: "Vape" },
  "Melted Strawberries": { type: "Hybrid", thc: "24-28%", genetics: "Strawberry Guava × Gelato", lineage: "Strawberry phenotype × Guava cross → Strawberry Guava | Sunset Sherbet × Thin Mint GSC → Gelato", flavor: "Melted strawberry, cream, sweet jam", effects: "Euphoric, relaxed, happy", terpenes: "Myrcene, Limonene, Linalool", description: "Like strawberries left in the sun — warm, sweet, and dripping with flavor. The 14-pack gives you this premium hybrid experience for sharing or savoring all week.", category: "14 Pack Prerolls" },
};

// ─── App Styles ────────────────────────────────────────────────────────────
const COLORS = {
  bg: "#0a0a0a",
  bgCard: "#141414",
  bgElevated: "#1a1a1a",
  bgGlass: "rgba(255,255,255,0.03)",
  text: "#ffffff",
  textMuted: "#888888",
  textDim: "#555555",
  accent: "#c8ff00",       // Dragonfly uses a bright lime/chartreuse
  accentDim: "rgba(200,255,0,0.15)",
  border: "rgba(255,255,255,0.08)",
  borderLight: "rgba(255,255,255,0.12)",
  indica: "#8b5cf6",
  sativa: "#f59e0b",
  hybrid: "#10b981",
  success: "#22c55e",
  error: "#ef4444",
};

const FONTS = {
  display: "'Oswald', sans-serif",
  body: "'DM Sans', sans-serif",
  mono: "'JetBrains Mono', monospace",
};

// ─── Component: App ────────────────────────────────────────────────────────
export default function DragonflyScanner() {
  const [screen, setScreen] = useState("home"); // home | scan | result | signup | thanks
  const [scannedStrain, setScannedStrain] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [signupData, setSignupData] = useState({ name: "", email: "", phone: "", age: false });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [scanStatus, setScanStatus] = useState("");
  const [ocrReady, setOcrReady] = useState(false);
  const canvasRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);

  // Load Google Fonts + preload Tesseract OCR
  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Oswald:wght@300;400;500;600;700&family=DM+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    // Preload Tesseract in background
    loadTesseract().then(() => setOcrReady(true)).catch(() => {});
  }, []);

  const strainNames = Object.keys(STRAIN_DB);
  const filteredStrains = searchQuery.length > 0
    ? strainNames.filter(s => s.toLowerCase().includes(searchQuery.toLowerCase()))
    : [];

  // Camera functions
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setCameraActive(true);
    } catch (err) {
      // Fallback: offer manual selection
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

  // ─── OCR: Capture frame from video and run OCR ──────────────────────────
  const captureAndOCR = useCallback(async (imageSource) => {
    setScanning(true);
    setScanProgress(10);
    setScanStatus("Loading OCR engine...");
    
    try {
      const Tesseract = await loadTesseract();
      setScanProgress(20);
      setScanStatus("Preparing image...");
      
      let imageData = imageSource;
      
      // If it's from the video feed, capture a frame to canvas
      if (imageSource === "camera" && videoRef.current) {
        const canvas = document.createElement("canvas");
        const video = videoRef.current;
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        // Enhance contrast for better OCR
        ctx.filter = "contrast(1.5) brightness(1.1)";
        ctx.drawImage(canvas, 0, 0);
        imageData = canvas.toDataURL("image/png");
      }
      
      setScanProgress(30);
      setScanStatus("Reading text from image...");
      
      const worker = await Tesseract.createWorker("eng");
      
      setScanProgress(50);
      setScanStatus("Analyzing label...");
      
      const { data } = await worker.recognize(imageData);
      await worker.terminate();
      
      setScanProgress(80);
      setScanStatus("Matching strain...");
      
      const ocrText = data.text;
      console.log("OCR raw text:", ocrText);
      
      // Try to match against our strain database
      const matched = fuzzyMatch(ocrText, strainNames);
      
      setScanProgress(100);
      
      if (matched) {
        setScanStatus(`Found: ${matched}`);
        setTimeout(() => {
          setScanning(false);
          setScanStatus("");
          setScannedStrain(matched);
          stopCamera();
          setScreen("result");
        }, 800);
      } else {
        setScanStatus("Couldn't identify strain. Try again or search manually.");
        setTimeout(() => {
          setScanning(false);
          setScanProgress(0);
          setScanStatus("");
        }, 2500);
      }
    } catch (err) {
      console.error("OCR error:", err);
      setScanStatus("Scan failed. Try uploading a photo instead.");
      setTimeout(() => {
        setScanning(false);
        setScanProgress(0);
        setScanStatus("");
      }, 2000);
    }
  }, [strainNames, stopCamera]);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        captureAndOCR(ev.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const goHome = () => {
    stopCamera();
    setScreen("home");
    setScannedStrain(null);
    setSearchQuery("");
    setShowSearch(false);
    setScanning(false);
    setScanProgress(0);
  };

  const typeColor = (type) => {
    if (type === "Indica") return COLORS.indica;
    if (type === "Sativa") return COLORS.sativa;
    return COLORS.hybrid;
  };

  // ─── Styles ──────────────────────────────────────────────────────────────
  const styles = {
    app: {
      fontFamily: FONTS.body,
      background: COLORS.bg,
      color: COLORS.text,
      minHeight: "100vh",
      minHeight: "100dvh",
      width: "100%",
      position: "relative",
      overflow: "hidden",
      WebkitFontSmoothing: "antialiased",
      MozOsxFontSmoothing: "grayscale",
    },
    header: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "12px 16px",
      paddingTop: "max(12px, env(safe-area-inset-top))",
      borderBottom: `1px solid ${COLORS.border}`,
      background: "rgba(10,10,10,0.95)",
      backdropFilter: "blur(20px)",
      WebkitBackdropFilter: "blur(20px)",
      position: "sticky",
      top: 0,
      zIndex: 100,
    },
    logo: {
      fontFamily: FONTS.display,
      fontSize: 22,
      fontWeight: 700,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: COLORS.text,
      cursor: "pointer",
    },
    logoAccent: {
      color: COLORS.accent,
    },
    navBtn: {
      background: "none",
      border: `1px solid ${COLORS.border}`,
      color: COLORS.textMuted,
      padding: "10px 16px",
      minHeight: 44,
      borderRadius: 8,
      fontSize: 13,
      fontFamily: FONTS.body,
      fontWeight: 500,
      cursor: "pointer",
      transition: "all 0.15s",
      display: "flex",
      alignItems: "center",
      gap: 6,
    },
    heroSection: {
      padding: "48px 20px 32px",
      textAlign: "center",
      position: "relative",
    },
    heroTagline: {
      fontFamily: FONTS.display,
      fontSize: 12,
      fontWeight: 300,
      letterSpacing: "0.25em",
      textTransform: "uppercase",
      color: COLORS.textMuted,
      marginBottom: 14,
    },
    heroTitle: {
      fontFamily: FONTS.display,
      fontSize: "clamp(36px, 10vw, 48px)",
      fontWeight: 700,
      lineHeight: 1.0,
      letterSpacing: "-0.01em",
      textTransform: "uppercase",
      marginBottom: 14,
    },
    heroSub: {
      fontSize: 15,
      color: COLORS.textMuted,
      lineHeight: 1.6,
      maxWidth: 320,
      margin: "0 auto 36px",
    },
    scanBtn: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      background: COLORS.accent,
      color: "#000",
      border: "none",
      padding: "18px 36px",
      minHeight: 56,
      borderRadius: 50,
      fontSize: 16,
      fontFamily: FONTS.display,
      fontWeight: 600,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      cursor: "pointer",
      transition: "transform 0.15s, opacity 0.15s",
      boxShadow: `0 0 40px ${COLORS.accentDim}`,
      WebkitTapHighlightColor: "transparent",
      touchAction: "manipulation",
    },
    browseBtn: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      background: "transparent",
      color: COLORS.textMuted,
      border: `1px solid ${COLORS.borderLight}`,
      padding: "14px 28px",
      minHeight: 50,
      borderRadius: 50,
      fontSize: 14,
      fontFamily: FONTS.display,
      fontWeight: 500,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      cursor: "pointer",
      marginTop: 16,
      transition: "all 0.15s",
      WebkitTapHighlightColor: "transparent",
      touchAction: "manipulation",
    },
    featureGrid: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: 12,
      padding: "0 20px 40px",
    },
    featureCard: {
      background: COLORS.bgCard,
      border: `1px solid ${COLORS.border}`,
      borderRadius: 12,
      padding: "20px 12px",
      textAlign: "center",
    },
    featureIcon: {
      fontSize: 28,
      marginBottom: 8,
    },
    featureLabel: {
      fontFamily: FONTS.display,
      fontSize: 11,
      fontWeight: 500,
      letterSpacing: "0.1em",
      textTransform: "uppercase",
      color: COLORS.textMuted,
    },
    // Scan screen
    scanContainer: {
      padding: 20,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 20,
    },
    videoWrapper: {
      width: "100%",
      maxWidth: 400,
      aspectRatio: "4/3",
      borderRadius: 16,
      overflow: "hidden",
      background: "#111",
      position: "relative",
      border: `2px solid ${COLORS.border}`,
    },
    video: {
      width: "100%",
      height: "100%",
      objectFit: "cover",
    },
    scanOverlay: {
      position: "absolute",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,0.3)",
    },
    scanFrame: {
      width: "70%",
      height: "60%",
      border: `2px solid ${COLORS.accent}`,
      borderRadius: 12,
      boxShadow: `0 0 60px ${COLORS.accentDim}, inset 0 0 60px rgba(200,255,0,0.05)`,
      animation: "pulse 2s infinite",
    },
    progressBar: {
      width: "100%",
      maxWidth: 400,
      height: 4,
      background: COLORS.bgCard,
      borderRadius: 2,
      overflow: "hidden",
    },
    progressFill: (pct) => ({
      width: `${Math.min(pct, 100)}%`,
      height: "100%",
      background: `linear-gradient(90deg, ${COLORS.accent}, #9eff00)`,
      transition: "width 0.2s ease-out",
      borderRadius: 2,
    }),
    orDivider: {
      display: "flex",
      alignItems: "center",
      gap: 16,
      width: "100%",
      maxWidth: 400,
      color: COLORS.textDim,
      fontSize: 12,
      fontFamily: FONTS.display,
      letterSpacing: "0.15em",
      textTransform: "uppercase",
    },
    dividerLine: {
      flex: 1,
      height: 1,
      background: COLORS.border,
    },
    uploadBtn: {
      width: "100%",
      maxWidth: 400,
      padding: "14px 20px",
      background: COLORS.bgCard,
      border: `1px dashed ${COLORS.borderLight}`,
      borderRadius: 12,
      color: COLORS.textMuted,
      fontSize: 14,
      fontFamily: FONTS.body,
      cursor: "pointer",
      textAlign: "center",
      transition: "all 0.2s",
    },
    // Result screen
    resultContainer: {
      padding: "0 20px 40px",
    },
    strainHeader: {
      padding: "32px 0 24px",
      textAlign: "center",
    },
    typeBadge: (color) => ({
      display: "inline-block",
      padding: "4px 14px",
      borderRadius: 50,
      fontSize: 11,
      fontFamily: FONTS.display,
      fontWeight: 600,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      color: color,
      background: color + "18",
      border: `1px solid ${color}40`,
      marginBottom: 12,
    }),
    strainName: {
      fontFamily: FONTS.display,
      fontSize: 38,
      fontWeight: 700,
      textTransform: "uppercase",
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
      letterSpacing: "0.15em",
      textTransform: "uppercase",
      color: COLORS.accent,
      marginBottom: 12,
    },
    statGrid: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 12,
    },
    statItem: {
      background: COLORS.bgGlass,
      borderRadius: 10,
      padding: "12px 14px",
    },
    statLabel: {
      fontSize: 10,
      fontFamily: FONTS.display,
      fontWeight: 500,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
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
      letterSpacing: "0.12em",
      textTransform: "uppercase",
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
      textAlign: "center",
      marginTop: 24,
    },
    ctaTitle: {
      fontFamily: FONTS.display,
      fontSize: 20,
      fontWeight: 600,
      textTransform: "uppercase",
      marginBottom: 8,
    },
    ctaText: {
      fontSize: 13,
      color: COLORS.textMuted,
      marginBottom: 20,
    },
    ctaBtn: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      background: COLORS.accent,
      color: "#000",
      border: "none",
      padding: "14px 32px",
      borderRadius: 50,
      fontSize: 14,
      fontFamily: FONTS.display,
      fontWeight: 600,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      cursor: "pointer",
    },
    // Signup form
    formContainer: {
      padding: "20px 20px 40px",
    },
    formTitle: {
      fontFamily: FONTS.display,
      fontSize: 32,
      fontWeight: 700,
      textTransform: "uppercase",
      textAlign: "center",
      marginBottom: 8,
    },
    formSub: {
      fontSize: 14,
      color: COLORS.textMuted,
      textAlign: "center",
      marginBottom: 32,
    },
    inputGroup: {
      marginBottom: 18,
    },
    inputLabel: {
      display: "block",
      fontSize: 11,
      fontFamily: FONTS.display,
      fontWeight: 500,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      color: COLORS.textMuted,
      marginBottom: 8,
    },
    input: {
      width: "100%",
      padding: "16px",
      background: COLORS.bgCard,
      border: `1px solid ${COLORS.border}`,
      borderRadius: 12,
      color: COLORS.text,
      fontSize: 16,
      fontFamily: FONTS.body,
      outline: "none",
      transition: "border-color 0.15s",
      boxSizing: "border-box",
      WebkitAppearance: "none",
      appearance: "none",
    },
    checkboxRow: {
      display: "flex",
      alignItems: "flex-start",
      gap: 12,
      marginBottom: 28,
      padding: "8px 0",
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
      width: "100%",
      padding: "18px",
      minHeight: 56,
      background: COLORS.accent,
      color: "#000",
      border: "none",
      borderRadius: 50,
      fontSize: 16,
      fontFamily: FONTS.display,
      fontWeight: 600,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      cursor: "pointer",
      transition: "transform 0.15s, opacity 0.15s",
      WebkitTapHighlightColor: "transparent",
      touchAction: "manipulation",
    },
    submitBtnDisabled: {
      opacity: 0.4,
      cursor: "not-allowed",
    },
    // Thanks screen
    thanksContainer: {
      padding: "80px 24px",
      textAlign: "center",
    },
    thanksIcon: {
      fontSize: 64,
      marginBottom: 24,
    },
    thanksTitle: {
      fontFamily: FONTS.display,
      fontSize: 36,
      fontWeight: 700,
      textTransform: "uppercase",
      marginBottom: 12,
    },
    thanksText: {
      fontSize: 15,
      color: COLORS.textMuted,
      lineHeight: 1.6,
      maxWidth: 300,
      margin: "0 auto 36px",
    },
    // Search overlay
    searchOverlay: {
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.98)",
      zIndex: 200,
      display: "flex",
      flexDirection: "column",
      paddingTop: "env(safe-area-inset-top)",
      paddingBottom: "env(safe-area-inset-bottom)",
    },
    searchHeader: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "12px 16px",
      borderBottom: `1px solid ${COLORS.border}`,
    },
    searchInput: {
      flex: 1,
      padding: "12px 0",
      background: "transparent",
      border: "none",
      color: COLORS.text,
      fontSize: 17,
      fontFamily: FONTS.body,
      outline: "none",
      WebkitAppearance: "none",
    },
    searchClose: {
      background: "none",
      border: "none",
      color: COLORS.textMuted,
      fontSize: 15,
      fontFamily: FONTS.body,
      cursor: "pointer",
      padding: "10px 14px",
      minHeight: 44,
    },
    searchResults: {
      flex: 1,
      overflowY: "auto",
      padding: "12px 20px",
    },
    searchItem: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "16px",
      minHeight: 64,
      background: COLORS.bgCard,
      border: `1px solid ${COLORS.border}`,
      borderRadius: 12,
      marginBottom: 8,
      cursor: "pointer",
      transition: "all 0.15s",
      touchAction: "manipulation",
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
      padding: "32px 20px",
      paddingBottom: "max(32px, env(safe-area-inset-bottom))",
      borderTop: `1px solid ${COLORS.border}`,
      textAlign: "center",
    },
    footerText: {
      fontSize: 11,
      color: COLORS.textDim,
      fontFamily: FONTS.mono,
      letterSpacing: "0.05em",
    },
    backBtn: {
      background: "none",
      border: "none",
      color: COLORS.textMuted,
      fontSize: 14,
      fontFamily: FONTS.body,
      cursor: "pointer",
      padding: "8px 0",
      display: "flex",
      alignItems: "center",
      gap: 6,
    },
    terpTag: {
      display: "inline-block",
      padding: "4px 10px",
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

  // ─── Render: Search Overlay ──────────────────────────────────────────────
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
            placeholder="Search strains..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            autoFocus
          />
          <button style={styles.searchClose} onClick={() => { setShowSearch(false); setSearchQuery(""); }}>
            Cancel
          </button>
        </div>
        <div style={styles.searchResults}>
          {searchQuery.length === 0 && (
            <div style={{ padding: "40px 0", textAlign: "center", color: COLORS.textDim, fontSize: 14 }}>
              Type a strain name to search
            </div>
          )}
          {filteredStrains.map(name => {
            const s = STRAIN_DB[name];
            return (
              <div
                key={name}
                style={styles.searchItem}
                onClick={() => {
                  setScannedStrain(name);
                  setShowSearch(false);
                  setSearchQuery("");
                  setScreen("result");
                }}
              >
                <div>
                  <div style={styles.searchItemName}>{name}</div>
                  <div style={styles.searchItemMeta}>{s.category} · {s.type}</div>
                </div>
                <div style={{ ...styles.typeBadge(typeColor(s.type)), marginBottom: 0, fontSize: 10 }}>
                  {s.type}
                </div>
              </div>
            );
          })}
          {searchQuery.length > 0 && filteredStrains.length === 0 && (
            <div style={{ padding: "40px 0", textAlign: "center", color: COLORS.textDim, fontSize: 14 }}>
              No strains found for "{searchQuery}"
            </div>
          )}
        </div>
      </div>
    );
  };

  // ─── Render: Home ────────────────────────────────────────────────────────
  const renderHome = () => (
    <>
      {/* Hero — Dragonfly Wings + Joint visual */}
      <div style={{
        position: "relative",
        width: "100%",
        minHeight: "85dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px 32px",
        overflow: "hidden",
      }}>
        {/* Background glow */}
        <div style={{
          position: "absolute",
          top: "30%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "120%",
          height: "60%",
          background: `radial-gradient(ellipse at center, ${COLORS.accentDim}, transparent 70%)`,
          opacity: 0.4,
          pointerEvents: "none",
        }} />

        {/* Wings image — the signature dragonfly wingspan */}
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

        {/* Preroll / joint image — the body of the dragonfly */}
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
          <div style={styles.featureIcon}>🧬</div>
          <div style={styles.featureLabel}>Genetics</div>
        </div>
        <div style={styles.featureCard}>
          <div style={styles.featureIcon}>🌿</div>
          <div style={styles.featureLabel}>Terpenes</div>
        </div>
        <div style={styles.featureCard}>
          <div style={styles.featureIcon}>⚡</div>
          <div style={styles.featureLabel}>Effects</div>
        </div>
      </div>
    </>
  );

  // ─── Render: Scan ────────────────────────────────────────────────────────
  const renderScan = () => (
    <div style={styles.scanContainer}>
      <button style={styles.backBtn} onClick={goHome}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
        </svg>
        Back
      </button>

      <div style={styles.videoWrapper}>
        <video ref={videoRef} style={styles.video} muted playsInline />
        {!scanning && (
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
            onClick={() => captureAndOCR("camera")}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v4m0 12v4M2 12h4m12 0h4" />
            </svg>
            Capture &amp; Identify
          </button>

          <div style={styles.orDivider}>
            <div style={styles.dividerLine} />
            <span>or</span>
            <div style={styles.dividerLine} />
          </div>

          <button style={styles.uploadBtn} onClick={() => fileInputRef.current?.click()}>
            📷 Upload a photo of your product
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleFileUpload}
          />

          <button
            style={{ ...styles.browseBtn, marginTop: 4 }}
            onClick={() => setShowSearch(true)}
          >
            Or search by strain name
          </button>
        </>
      )}
    </div>
  );

  // ─── Render: Result ──────────────────────────────────────────────────────
  const renderResult = () => {
    if (!scannedStrain || !STRAIN_DB[scannedStrain]) return null;
    const s = STRAIN_DB[scannedStrain];
    const tc = typeColor(s.type);

    return (
      <div style={styles.resultContainer}>
        <button style={{ ...styles.backBtn, marginTop: 16 }} onClick={goHome}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
          </svg>
          Scan Another
        </button>

        <div style={styles.strainHeader}>
          <div style={styles.typeBadge(tc)}>{s.type}</div>
          <h1 style={styles.strainName}>{scannedStrain}</h1>
          <div style={styles.strainCategory}>{s.category} · THC {s.thc}</div>
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
            Join the Hive →
          </button>
        </div>
      </div>
    );
  };

  // ─── Render: Signup ──────────────────────────────────────────────────────
  const renderSignup = () => {
    const canSubmit = signupData.name && signupData.email && signupData.age;
    return (
      <div style={styles.formContainer}>
        <button style={styles.backBtn} onClick={() => setScreen(scannedStrain ? "result" : "home")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
          </svg>
          Back
        </button>

        <div style={{ padding: "24px 0 0", textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🐉</div>
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
  };

  // ─── Render: Thanks ──────────────────────────────────────────────────────
  const renderThanks = () => (
    <div style={styles.thanksContainer}>
      <div style={styles.thanksIcon}>✅</div>
      <h2 style={styles.thanksTitle}>You're In</h2>
      <p style={styles.thanksText}>
        Welcome to the Dragonfly Hive. Watch your inbox for exclusive deals, new strain drops, and rewards.
      </p>
      <button style={styles.scanBtn} onClick={goHome}>
        Scan Another Product
      </button>
    </div>
  );

  // ─── Main Render ─────────────────────────────────────────────────────────
  return (
    <div style={styles.app}>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
        html { overflow-y: scroll; -webkit-overflow-scrolling: touch; }
        input:focus { border-color: ${COLORS.accent} !important; outline: none; }
        button { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
        button:active { transform: scale(0.97); opacity: 0.85; }
        select, textarea, input { font-size: 16px; } /* Prevent iOS zoom */
        ::-webkit-scrollbar { width: 0; display: none; }
        /* Disable pull-to-refresh on mobile */
        body { overscroll-behavior-y: contain; }
      `}</style>

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
      {screen === "result" && renderResult()}
      {screen === "signup" && renderSignup()}
      {screen === "thanks" && renderThanks()}

      {/* Footer */}
      <footer style={styles.footer}>
        <div style={styles.footerText}>
          DRAGONFLY · NEW YORK · MICHIGAN<br />
          No hype, no bling, no burn. Just real good weed.<br />
          <span style={{ color: COLORS.textDim }}>© 2026 Dragonfly Brand. 21+ only.</span>
        </div>
      </footer>

      {/* Search Overlay */}
      {renderSearch()}
    </div>
  );
}
