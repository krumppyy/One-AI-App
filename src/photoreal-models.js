// One AI Studio - Photoreal Diffusion Base Models & Diverse Captioned References
// Models: Anki-Human-Photoreal-SDXL & Anki-Creative-Stylist-FLUX
// 25 Diverse Captioned References with 85mm, 35mm, 140mm, 50mm, 24mm Lenses & Real Diffusion Routing

export const PHOTOREAL_BASE_MODELS = [
  {
    id: "anki-human-photoreal-sdxl",
    name: "Anki-Human-Photoreal-SDXL",
    category: "Photoreal Human Studio",
    vendor: "Stability AI / One AI Neural",
    license: "Open Community",
    params: "3.5B LoRA / DreamBooth",
    arch: "lora-adapter",
    task: "img2img",
    loraTarget: "UNet CrossAttention & Linear Projections",
    desc: "Dedicated photorealistic human portrait and figure foundation. Captures authentic human skin pores, micro-creases, subsurface scattering, authentic facial anatomy, and multi-focal lens optics (85mm, 50mm, 35mm, 140mm, 24mm).",
    badge: "Photoreal SDXL",
    diffusionModel: "turbo",
    defaultPrompt: "Studio portrait of an authentic human, 85mm f/1.4 lens, natural skin pores, realistic subsurface scattering, delicate catchlights in eyes, soft cinematic rim light, neutral studio backdrop, 8k ultra-detailed photoreal",
    defaultNegative: "deformed anatomy, disfigured, extra fingers, mutated hands, missing limbs, fused fingers, bad anatomy, unnatural skin smoothness, plastic wax skin, asymmetric eyes, lowres, blurry, distorted face, extra arms, bad proportions",
  },
  {
    id: "anki-creative-stylist-flux",
    name: "Anki-Creative-Stylist-FLUX",
    category: "Creative Concept Studio",
    vendor: "Black Forest Labs / One AI Neural",
    license: "Apache 2.0",
    params: "12B LoRA / DreamBooth",
    arch: "lora-adapter",
    task: "img2img",
    loraTarget: "Single & Double Stream Attention Blocks",
    desc: "State-of-the-art creative concept and style transformation model built on FLUX.1. Transforms images with intricate prompt-following, volumetric atmospheric lighting, cyberpunk aesthetics, fantasy realism, and octane render fidelity.",
    badge: "Creative FLUX.1",
    diffusionModel: "flux",
    defaultPrompt: "Cinematic concept art of a futuristic figure in a rain-slicked neon metropolis, volumetric rim lighting, intricate mechanical detailing, octane render, unreal engine 5 lighting, dramatic composition, 8k resolution",
    defaultNegative: "blurry, cartoonish, low quality, oversaturated, flat lighting, artifacts, draft, lowres, muddy textures, deformed limbs",
  },
];

export const DIVERSE_CAPTIONED_REFS = [
  {
    id: "ref-01",
    name: "Ref-01-Female-85mm-StudioPores",
    caption: "Studio portrait of a 28-year-old woman, 85mm f/1.4 lens, natural skin pores, realistic subsurface scattering, delicate catchlights in eyes, soft cinematic rim light, neutral studio backdrop, 8k ultra-detailed photoreal",
    lens: "85mm f/1.4",
    lighting: "Studio Rim Light",
    seed: 104201,
    subject: "Female Portrait",
  },
  {
    id: "ref-02",
    name: "Ref-02-Male-50mm-GoldenHour",
    caption: "Close-up portrait of a 42-year-old man with subtle silver beard stubble, 50mm f/1.8 prime lens, warm golden hour sidelight, crisp natural skin texture, micro-creases around eyes, cinematic depth of field",
    lens: "50mm f/1.8",
    lighting: "Golden Hour Sun",
    seed: 104202,
    subject: "Male Portrait",
  },
  {
    id: "ref-03",
    name: "Ref-03-Female-35mm-EditorialDusk",
    caption: "Editorial fashion portrait of East Asian woman, 35mm f/2.0 lens, soft volumetric dusk light, delicate skin tone, natural porcelain texture, sharp eye reflections, urban architectural background bokeh",
    lens: "35mm f/2.0",
    lighting: "Volumetric Dusk",
    seed: 104203,
    subject: "Fashion Editorial",
  },
  {
    id: "ref-04",
    name: "Ref-04-Male-140mm-TeleCompression",
    caption: "High-compression portrait of athlete, 140mm telephoto lens, dramatic rembrandt lighting, sweat sheen and fine skin pores, authentic muscle definition in neck, dark textured background, sharp focus",
    lens: "140mm Telephoto",
    lighting: "Rembrandt Key",
    seed: 104204,
    subject: "Athletic Character",
  },
  {
    id: "ref-05",
    name: "Ref-05-Elder-24mm-EnvironmentalCandid",
    caption: "Candid environmental portrait of smiling elder artisan, 24mm wide angle lens, gentle ambient north light, authentic weathered skin pores, deep laugh lines, workshop background in soft focus",
    lens: "24mm Wide Angle",
    lighting: "Ambient North Light",
    seed: 104205,
    subject: "Elder Character",
  },
  {
    id: "ref-06",
    name: "Ref-06-Female-85mm-RembrandtClassic",
    caption: "Classic fine art portrait of young African woman, 85mm f/1.4 lens, rich rembrandt triangle on cheek, luminous skin pores, authentic subsurface glow, deep brown iris detail, dark velvet backdrop",
    lens: "85mm f/1.4",
    lighting: "Rembrandt Key",
    seed: 104206,
    subject: "Fine Art Portrait",
  },
  {
    id: "ref-07",
    name: "Ref-07-Male-50mm-CyberpunkAtmosphere",
    caption: "Cinematic portrait of cybernetic engineer, 50mm f/1.8 lens, cyan and magenta dual rim light, micro-pores and faint scar texture, reflective ocular lens, atmospheric haze",
    lens: "50mm f/1.8",
    lighting: "Cyan/Magenta Rim",
    seed: 104207,
    subject: "Cyberpunk Character",
  },
  {
    id: "ref-08",
    name: "Ref-08-Female-140mm-BeautyMacro",
    caption: "Extreme beauty macro portrait, 140mm telephoto macro, ring softbox illumination, individual skin pores and natural peach fuzz, glossy lip texture, razor-sharp eyelashes",
    lens: "140mm Telephoto",
    lighting: "Ring Softbox",
    seed: 104208,
    subject: "Beauty Macro",
  },
  {
    id: "ref-09",
    name: "Ref-09-Male-35mm-StreetDocumentary",
    caption: "Documentary street portrait of musician, 35mm f/2.0 lens, rainy afternoon diffused daylight, water droplet highlights on skin, natural pores, authentic candid expression",
    lens: "35mm f/2.0",
    lighting: "Overcast Diffused",
    seed: 104209,
    subject: "Documentary Street",
  },
  {
    id: "ref-10",
    name: "Ref-10-Female-24mm-CinematicMedium",
    caption: "Cinematic medium shot of female scientist in laboratory, 24mm anamorphic lens, cool fluorescent key with warm tungsten fill, natural skin pores, realistic anatomy and posture",
    lens: "24mm Wide Angle",
    lighting: "Cool Fluorescent Fill",
    seed: 104210,
    subject: "Cinematic Medium",
  },
  {
    id: "ref-11",
    name: "Ref-11-Male-85mm-MonochromeNoir",
    caption: "High-contrast dramatic monochrome portrait of detective, 85mm f/1.4 lens, hard slit light through venetian blinds, deep skin pore shadows, intense gaze, cinematic noir 35mm film grain",
    lens: "85mm f/1.4",
    lighting: "Slit Blind Hard Light",
    seed: 104211,
    subject: "Cinematic Noir",
  },
  {
    id: "ref-12",
    name: "Ref-12-Female-50mm-SunDappledGarden",
    caption: "Natural daylight portrait of Latina model, 50mm f/1.8 lens, dappled sunlight filtering through foliage, soft skin pores and natural freckles, warm golden undertone, organic bokeh",
    lens: "50mm f/1.8",
    lighting: "Dappled Sun Foliage",
    seed: 104212,
    subject: "Sun Dappled Garden",
  },
  {
    id: "ref-13",
    name: "Ref-13-Male-140mm-ExecutivePortrait",
    caption: "Executive editorial headshot, 140mm lens, large octabox key light with subtle hair light, ultra-clean skin texture, authentic pore definition, professional tailored collar",
    lens: "140mm Telephoto",
    lighting: "Octabox Studio",
    seed: 104213,
    subject: "Executive Studio",
  },
  {
    id: "ref-14",
    name: "Ref-14-Female-35mm-NeonCyberSurreal",
    caption: "Surreal concept portrait, 35mm f/2.0, neon ultraviolet rim light, iridescent skin pigment, realistic facial anatomy, intricate chromatic reflections in eyes, volumetric smoke",
    lens: "35mm f/2.0",
    lighting: "Ultraviolet Rim",
    seed: 104214,
    subject: "Surreal Concept",
  },
  {
    id: "ref-15",
    name: "Ref-15-Elder-85mm-WisdomTexture",
    caption: "Character study portrait of Native elder, 85mm f/1.4, directional sunset sidelight, richly textured skin pores and authentic character lines, calm dignified gaze, ultra photoreal",
    lens: "85mm f/1.4",
    lighting: "Sunset Sidelight",
    seed: 104215,
    subject: "Character Study",
  },
  {
    id: "ref-16",
    name: "Ref-16-Female-50mm-RainSlickedCity",
    caption: "Atmospheric evening portrait, 50mm f/1.8, reflections of city traffic in background, wet strands of hair across cheek, glistening skin pores and rain highlights, cinematic depth",
    lens: "50mm f/1.8",
    lighting: "City Bokeh Night",
    seed: 104216,
    subject: "Rain Slicked City",
  },
  {
    id: "ref-17",
    name: "Ref-17-Male-24mm-ActionHeroDynamic",
    caption: "Low-angle heroic portrait of firefighter, 24mm wide angle, warm firelight glow mixed with emergency blue beacon light, soot smudges over authentic skin pores, intense heroic expression",
    lens: "24mm Wide Angle",
    lighting: "Firelight & Blue Beacon",
    seed: 104217,
    subject: "Heroic Action",
  },
  {
    id: "ref-18",
    name: "Ref-18-Female-140mm-FashionRunway",
    caption: "Runway fashion capture, 140mm telephoto f/2.8, intense runway overhead spots, crisp skin pore detail, high cheekbone contour, glossy eyelid finish, motion-frozen hair",
    lens: "140mm Telephoto",
    lighting: "Overhead Runway Spots",
    seed: 104218,
    subject: "Fashion Runway",
  },
  {
    id: "ref-19",
    name: "Ref-19-Male-35mm-VintageSepiaAnalog",
    caption: "Intimate artist studio portrait, 35mm prime lens, warm tungsten painter lamp, soft skin pores, authentic hand and face anatomical proportion, textured canvas backdrop",
    lens: "35mm f/2.0",
    lighting: "Tungsten Artist Lamp",
    seed: 104219,
    subject: "Artist Studio",
  },
  {
    id: "ref-20",
    name: "Ref-20-Female-85mm-SubsurfaceEthereal",
    caption: "Ethereal high-key portrait of Scandinavian woman, 85mm f/1.4, diffused window fog illumination, pale translucent skin with natural subsurface glow and fine pores, crystalline blue eyes",
    lens: "85mm f/1.4",
    lighting: "Diffused High-Key Window",
    seed: 104220,
    subject: "High-Key Ethereal",
  },
  {
    id: "ref-21",
    name: "Ref-21-Male-50mm-FitnessStudio",
    caption: "Athletic portrait of South Asian boxer, 50mm f/1.8, dual cross-lateral strip boxes, defined clavicle and jawline anatomy, realistic sweat beads and skin pores, focused gaze",
    lens: "50mm f/1.8",
    lighting: "Dual Cross Strip",
    seed: 104221,
    subject: "Athletic Fitness",
  },
  {
    id: "ref-22",
    name: "Ref-22-Female-24mm-ArchitecturalModern",
    caption: "Minimalist architectural portrait, 24mm lens, stark geometric shadow play, clean natural skin pores, neutral skin tone, concrete and glass environment in dramatic perspective",
    lens: "24mm Wide Angle",
    lighting: "Direct Geometric Sun",
    seed: 104222,
    subject: "Architectural Minimalist",
  },
  {
    id: "ref-23",
    name: "Ref-23-Male-140mm-WildlifeExplorer",
    caption: "Weathered expedition portrait of explorer, 140mm telephoto, mountain overcast backlight, wind-chapped skin texture with visible micro-pores, squinting focused eyes, snowcapped peaks background",
    lens: "140mm Telephoto",
    lighting: "Mountain Overcast",
    seed: 104223,
    subject: "Expedition Explorer",
  },
  {
    id: "ref-24",
    name: "Ref-24-Female-35mm-CyberpunkRebel",
    caption: "Sci-fi portrait of rebellion pilot, 35mm f/2.0, cockpit holographic dashboard glow, detailed skin pores, intricate cyber-implant at temple, intense expression, atmospheric reflections",
    lens: "35mm f/2.0",
    lighting: "Cockpit Hologram Glow",
    seed: 104224,
    subject: "Sci-Fi Pilot",
  },
  {
    id: "ref-25",
    name: "Ref-25-Male-85mm-CinematicMasterpiece",
    caption: "Award-winning cinematic film portrait, 85mm f/1.4 anamorphic prime, balanced key and ambient rim light, photorealistic skin pores and natural micro-textures, perfect anatomical facial symmetry, 8k masterpiece",
    lens: "85mm f/1.4",
    lighting: "Cinematic Key & Rim",
    seed: 104225,
    subject: "Cinematic Masterpiece",
  },
];

/**
 * Routes photoreal generation to real SDXL/FLUX diffusion models with seed lock and anatomy negative.
 * Returns { blob, url, model, source } or null if offline.
 */
export async function fetchRealDiffusionImage({
  prompt,
  negative = "",
  width = 1280,
  height = 720,
  seed = 424242,
  model = "turbo",
}) {
  const negText = String(negative || "").trim();
  const fullPrompt = negText ? `${prompt} (avoiding: ${negText})` : prompt;

  // Snap to clean 64-multiples for diffusion encoders
  const w = Math.min(1280, Math.max(512, Math.round(width / 64) * 64));
  const h = Math.min(1280, Math.max(512, Math.round(height / 64) * 64));

  const targetModel = String(model).toLowerCase().includes("flux") ? "flux" : "turbo";
  const directUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=${w}&height=${h}&seed=${seed}&nologo=true&model=${targetModel}`;

  // 1. Direct fetch from browser
  try {
    const res = await fetch(directUrl);
    if (res.ok) {
      const blob = await res.blob();
      if (blob && blob.size > 2048) {
        return { blob, url: URL.createObjectURL(blob), model: targetModel, source: "direct" };
      }
    }
  } catch (e) {
    console.warn("Direct real diffusion fetch error:", e?.message);
  }

  // 2. Server proxy fallback (/api/proxy)
  try {
    const proxyUrl = `/api/proxy?url=${encodeURIComponent(directUrl)}`;
    const res = await fetch(proxyUrl);
    if (res.ok) {
      const blob = await res.blob();
      if (blob && blob.size > 2048) {
        return { blob, url: URL.createObjectURL(blob), model: targetModel, source: "proxy" };
      }
    }
  } catch (e) {
    console.warn("Server proxy real diffusion error:", e?.message);
  }

  // 3. Fallback to default Pollinations endpoint without explicit model param
  try {
    const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&seed=${seed}&nologo=true`;
    const res = await fetch(fallbackUrl);
    if (res.ok) {
      const blob = await res.blob();
      if (blob && blob.size > 2048) {
        return { blob, url: URL.createObjectURL(blob), model: "turbo-fallback", source: "fallback" };
      }
    }
  } catch (e) {
    console.warn("Fallback real diffusion error:", e?.message);
  }

  return null;
}
