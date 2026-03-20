// ============================================================================
// LivoraPulse — East African Food Database
// Sources: Kenya Food Composition Tables (KFCT) 2018 (FAO/Government of Kenya),
//          USDA FoodData Central, SnapCalorie, verified recipe nutritional data.
// All values are per 100g cooked/prepared weight unless noted.
// ============================================================================

export interface LocalFood {
  id: string
  name: string                // Primary name (local Swahili/tribal name)
  aliases: string[]           // Alternative names and English equivalents
  category: string
  community: string           // Community/region of origin
  calories: number            // kcal per 100g
  proteinG: number
  carbsG: number
  fatG: number
  servingSize: string         // Typical serving description
  servingGrams: number        // Typical serving in grams
}

export const KENYAN_FOODS: LocalFood[] = [

  // ──────────────────────────────────────────────────────────────────────────
  // STAPLES — Ugali & Grains
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'ugali-white',
    name: 'Ugali',
    aliases: ['ugali wa unga wa mahindi', 'posho', 'cornmeal porridge', 'stiff porridge'],
    category: 'Staples',
    community: 'All Kenya',
    calories: 122, proteinG: 2.7, carbsG: 27.0, fatG: 0.4,
    servingSize: '1 serving (medium piece)', servingGrams: 150,
  },
  {
    id: 'ugali-millet',
    name: 'Ugali wa Wimbi',
    aliases: ['millet ugali', 'finger millet ugali', 'wimbi ugali'],
    category: 'Staples',
    community: 'Western Kenya / Luo',
    calories: 131, proteinG: 3.8, carbsG: 27.6, fatG: 1.2,
    servingSize: '1 serving (medium piece)', servingGrams: 150,
  },
  {
    id: 'ugali-sorghum',
    name: 'Ugali wa Mtama',
    aliases: ['sorghum ugali', 'mtama ugali'],
    category: 'Staples',
    community: 'Western / Eastern Kenya',
    calories: 125, proteinG: 3.5, carbsG: 27.0, fatG: 1.0,
    servingSize: '1 serving (medium piece)', servingGrams: 150,
  },
  {
    id: 'ugali-cassava',
    name: 'Ugali wa Muhogo',
    aliases: ['cassava ugali', 'muhogo ugali'],
    category: 'Staples',
    community: 'Coastal / Eastern Kenya',
    calories: 118, proteinG: 0.6, carbsG: 28.5, fatG: 0.2,
    servingSize: '1 serving (medium piece)', servingGrams: 150,
  },
  {
    id: 'rice-plain',
    name: 'Wali',
    aliases: ['white rice', 'boiled rice', 'plain rice'],
    category: 'Staples',
    community: 'All Kenya',
    calories: 130, proteinG: 2.7, carbsG: 28.2, fatG: 0.3,
    servingSize: '1 cup cooked', servingGrams: 186,
  },
  {
    id: 'chapati',
    name: 'Chapati',
    aliases: ['kenyan chapati', 'flatbread', 'roti'],
    category: 'Staples',
    community: 'All Kenya (Indian influence)',
    calories: 236, proteinG: 6.3, carbsG: 38.0, fatG: 7.0,
    servingSize: '1 chapati', servingGrams: 60,
  },
  {
    id: 'mandazi',
    name: 'Mandazi',
    aliases: ['maandazi', 'east african doughnut', 'mahambri', 'swahili doughnut', 'mandasi'],
    category: 'Staples',
    community: 'Coastal Kenya / Swahili',
    calories: 290, proteinG: 6.0, carbsG: 44.0, fatG: 9.5,
    servingSize: '1 piece', servingGrams: 60,
  },
  {
    id: 'mkate-mayai',
    name: 'Mkate wa Mayai',
    aliases: ['egg bread', 'kenyan egg bread'],
    category: 'Staples',
    community: 'Coastal Kenya',
    calories: 245, proteinG: 8.5, carbsG: 32.0, fatG: 9.0,
    servingSize: '1 piece', servingGrams: 80,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // MASHED DISHES
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'mukimo',
    name: 'Mukimo',
    aliases: ['mashed potatoes greens peas', 'kikuyu mash', 'irio'],
    category: 'Mashed Dishes',
    community: 'Kikuyu / Central Kenya',
    calories: 108, proteinG: 3.5, carbsG: 21.0, fatG: 1.5,
    servingSize: '1 cup', servingGrams: 200,
  },
  {
    id: 'irio',
    name: 'Irio',
    aliases: ['nyama na irio', 'mashed peas corn potatoes', 'kikuyu irio'],
    category: 'Mashed Dishes',
    community: 'Kikuyu / Meru',
    calories: 112, proteinG: 4.2, carbsG: 22.0, fatG: 1.3,
    servingSize: '1 cup', servingGrams: 200,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // STEWS & COOKED DISHES
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'githeri',
    name: 'Githeri',
    aliases: ['corn and beans stew', 'maize and bean stew', 'skuma githeri'],
    category: 'Stews',
    community: 'Kikuyu / All Kenya',
    calories: 155, proteinG: 7.8, carbsG: 27.5, fatG: 2.2,
    servingSize: '1 cup', servingGrams: 220,
  },
  {
    id: 'maharagwe',
    name: 'Maharagwe',
    aliases: ['red kidney beans stew', 'beans stew', 'bean soup'],
    category: 'Stews',
    community: 'All Kenya',
    calories: 132, proteinG: 8.5, carbsG: 20.0, fatG: 2.8,
    servingSize: '1 cup', servingGrams: 240,
  },
  {
    id: 'ndengu',
    name: 'Ndengu',
    aliases: ['green grams', 'mung beans', 'green gram stew', 'dhal'],
    category: 'Stews',
    community: 'All Kenya',
    calories: 105, proteinG: 7.0, carbsG: 18.5, fatG: 0.5,
    servingSize: '1 cup', servingGrams: 240,
  },
  {
    id: 'mbaazi',
    name: "M'baazi",
    aliases: ['pigeon peas coconut', 'mbaazi wa nazi', 'pigeon peas'],
    category: 'Stews',
    community: 'Coastal Kenya / Swahili',
    calories: 148, proteinG: 8.2, carbsG: 21.0, fatG: 3.5,
    servingSize: '1 cup', servingGrams: 240,
  },
  {
    id: 'kenyan-beef-stew',
    name: 'Mchuzi wa Nyama',
    aliases: ['beef stew', 'kenyan beef stew', 'meat stew'],
    category: 'Stews',
    community: 'All Kenya',
    calories: 142, proteinG: 14.5, carbsG: 8.0, fatG: 6.5,
    servingSize: '1 cup', servingGrams: 250,
  },
  {
    id: 'sukuma-wiki',
    name: 'Sukuma Wiki',
    aliases: ['collard greens', 'braised kale', 'kale stew', 'skuma'],
    category: 'Vegetables',
    community: 'All Kenya',
    calories: 38, proteinG: 2.5, carbsG: 5.5, fatG: 1.5,
    servingSize: '1 cup cooked', servingGrams: 130,
  },
  {
    id: 'spinach-cooked',
    name: 'Mchicha',
    aliases: ['cooked spinach', 'spinach stew', 'african spinach'],
    category: 'Vegetables',
    community: 'All Kenya / Coastal',
    calories: 35, proteinG: 3.0, carbsG: 4.5, fatG: 0.8,
    servingSize: '1 cup cooked', servingGrams: 130,
  },
  {
    id: 'managu',
    name: 'Managu',
    aliases: ['african nightshade', 'black nightshade', 'wild spinach', 'mnavu'],
    category: 'Vegetables',
    community: 'Luhya / Western Kenya',
    calories: 30, proteinG: 2.8, carbsG: 4.0, fatG: 0.5,
    servingSize: '1 cup cooked', servingGrams: 130,
  },
  {
    id: 'mrenda',
    name: 'Mrenda',
    aliases: ['jute mallow', 'luo vegetable', 'apoth', 'mlenda', 'corchorus'],
    category: 'Vegetables',
    community: 'Luo / Western Kenya',
    calories: 28, proteinG: 3.0, carbsG: 3.5, fatG: 0.5,
    servingSize: '1 cup cooked', servingGrams: 130,
  },
  {
    id: 'tsisaka',
    name: 'Tsisaka',
    aliases: ['luhya spider plant', 'spider plant vegetable', 'cats whiskers'],
    category: 'Vegetables',
    community: 'Luhya / Western Kenya',
    calories: 26, proteinG: 2.2, carbsG: 3.8, fatG: 0.4,
    servingSize: '1 cup cooked', servingGrams: 130,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // GRILLED / ROASTED MEATS
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'nyama-choma-beef',
    name: 'Nyama Choma (Beef)',
    aliases: ['grilled beef', 'roasted beef', 'choma beef'],
    category: 'Grilled Meats',
    community: 'All Kenya / Maasai',
    calories: 215, proteinG: 26.0, carbsG: 0.0, fatG: 12.0,
    servingSize: '1 serving', servingGrams: 150,
  },
  {
    id: 'nyama-choma-goat',
    name: 'Mbuzi Choma',
    aliases: ['grilled goat', 'roasted goat', 'nyama choma goat', 'choma mbuzi'],
    category: 'Grilled Meats',
    community: 'All Kenya / Maasai',
    calories: 144, proteinG: 20.5, carbsG: 0.0, fatG: 6.8,
    servingSize: '1 serving', servingGrams: 150,
  },
  {
    id: 'kuku-choma',
    name: 'Kuku Choma',
    aliases: ['grilled chicken', 'roasted chicken', 'choma chicken'],
    category: 'Grilled Meats',
    community: 'All Kenya',
    calories: 165, proteinG: 25.0, carbsG: 0.0, fatG: 7.0,
    servingSize: '1 serving', servingGrams: 150,
  },
  {
    id: 'ingoho',
    name: 'Ingoho',
    aliases: ['luhya chicken', 'free range chicken stew', 'kienyeji chicken'],
    category: 'Chicken Dishes',
    community: 'Luhya / Western Kenya',
    calories: 175, proteinG: 24.0, carbsG: 4.5, fatG: 7.5,
    servingSize: '1 serving with sauce', servingGrams: 200,
  },
  {
    id: 'mishkaki',
    name: 'Mishkaki',
    aliases: ['meat skewers', 'kenyan kebab', 'beef skewers'],
    category: 'Grilled Meats',
    community: 'Coastal Kenya / All Kenya',
    calories: 185, proteinG: 22.0, carbsG: 3.0, fatG: 9.0,
    servingSize: '3 skewers', servingGrams: 120,
  },
  {
    id: 'mutura',
    name: 'Mutura',
    aliases: ['kenyan sausage', 'african blood sausage', 'goat sausage', 'kenya sausage'],
    category: 'Street Food',
    community: 'Kikuyu / Nairobi street food',
    calories: 295, proteinG: 18.0, carbsG: 4.0, fatG: 23.0,
    servingSize: '1 piece', servingGrams: 100,
  },
  {
    id: 'matumbo',
    name: 'Matumbo',
    aliases: ['tripe stew', 'offal stew', 'beef tripe'],
    category: 'Stews',
    community: 'All Kenya',
    calories: 100, proteinG: 14.0, carbsG: 1.5, fatG: 4.5,
    servingSize: '1 cup', servingGrams: 200,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // FISH
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'tilapia-fried',
    name: 'Samaki wa Kukaanga',
    aliases: ['fried tilapia', 'fried fish', 'tilapia fried'],
    category: 'Fish',
    community: 'Luo / Lakeshore / All Kenya',
    calories: 176, proteinG: 20.5, carbsG: 3.5, fatG: 8.5,
    servingSize: '1 medium fish', servingGrams: 150,
  },
  {
    id: 'tilapia-cooked',
    name: 'Samaki wa Kupika',
    aliases: ['cooked tilapia', 'boiled fish', 'tilapia stew'],
    category: 'Fish',
    community: 'Luo / All Kenya',
    calories: 128, proteinG: 22.0, carbsG: 0.0, fatG: 4.0,
    servingSize: '1 medium fish', servingGrams: 150,
  },
  {
    id: 'dagaa',
    name: 'Dagaa',
    aliases: ['omena', 'silver cyprinid', 'small dried fish', 'lake sardines'],
    category: 'Fish',
    community: 'Luo / Lakeshore Kenya',
    calories: 295, proteinG: 58.0, carbsG: 0.0, fatG: 7.0,
    servingSize: '1/4 cup dried', servingGrams: 40,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // COASTAL DISHES
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'wali-wa-nazi',
    name: 'Wali wa Nazi',
    aliases: ['coconut rice', 'rice in coconut milk', 'pilau wa nazi'],
    category: 'Rice Dishes',
    community: 'Coastal Kenya / Swahili',
    calories: 185, proteinG: 3.2, carbsG: 32.0, fatG: 5.5,
    servingSize: '1 cup cooked', servingGrams: 200,
  },
  {
    id: 'pilau',
    name: 'Pilau',
    aliases: ['kenyan pilau', 'spiced rice', 'beef pilau', 'chicken pilau'],
    category: 'Rice Dishes',
    community: 'Coastal Kenya / All Kenya',
    calories: 175, proteinG: 8.5, carbsG: 28.0, fatG: 4.0,
    servingSize: '1 cup cooked', servingGrams: 200,
  },
  {
    id: 'biryani',
    name: 'Biryani',
    aliases: ['kenyan biryani', 'mombasa biryani', 'coastal biryani'],
    category: 'Rice Dishes',
    community: 'Coastal Kenya',
    calories: 195, proteinG: 10.0, carbsG: 30.0, fatG: 5.5,
    servingSize: '1 cup', servingGrams: 200,
  },
  {
    id: 'kuku-paka',
    name: 'Kuku Paka',
    aliases: ['coconut chicken curry', 'kenyan coconut chicken', 'coastal chicken'],
    category: 'Chicken Dishes',
    community: 'Coastal Kenya / Swahili',
    calories: 195, proteinG: 22.0, carbsG: 6.0, fatG: 10.0,
    servingSize: '1 serving', servingGrams: 250,
  },
  {
    id: 'samaki-wa-kupaka',
    name: 'Samaki wa Kupaka',
    aliases: ['fish in coconut sauce', 'grilled fish coconut', 'coastal fish curry'],
    category: 'Fish',
    community: 'Coastal Kenya',
    calories: 160, proteinG: 18.5, carbsG: 5.5, fatG: 7.5,
    servingSize: '1 serving', servingGrams: 200,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // TUBERS & ROOTS
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'nduma',
    name: 'Nduma',
    aliases: ['arrowroot', 'taro root', 'cocoyam', 'arrow root'],
    category: 'Tubers',
    community: 'Kikuyu / Central Kenya',
    calories: 112, proteinG: 1.5, carbsG: 26.5, fatG: 0.2,
    servingSize: '1 medium piece', servingGrams: 100,
  },
  {
    id: 'ngwaci',
    name: 'Ngwaci',
    aliases: ['sweet potato', 'boiled sweet potato', 'viazi vitamu'],
    category: 'Tubers',
    community: 'Kikuyu / All Kenya',
    calories: 86, proteinG: 1.6, carbsG: 20.0, fatG: 0.1,
    servingSize: '1 medium', servingGrams: 130,
  },
  {
    id: 'muhogo',
    name: 'Muhogo wa Kuchemsha',
    aliases: ['boiled cassava', 'cassava', 'cassava boiled', 'mianga'],
    category: 'Tubers',
    community: 'Coastal / Eastern Kenya',
    calories: 160, proteinG: 1.4, carbsG: 38.0, fatG: 0.3,
    servingSize: '1 piece boiled', servingGrams: 100,
  },
  {
    id: 'ikwa',
    name: 'Ikwa',
    aliases: ['yam', 'boiled yam', 'wild yam'],
    category: 'Tubers',
    community: 'Kikuyu / Central Kenya',
    calories: 118, proteinG: 1.5, carbsG: 27.0, fatG: 0.2,
    servingSize: '1 piece', servingGrams: 100,
  },
  {
    id: 'matoke',
    name: 'Matoke',
    aliases: ['green banana', 'cooked plantain', 'banana stew', 'east african banana'],
    category: 'Tubers',
    community: 'Western Kenya / Kisii / Uganda border',
    calories: 90, proteinG: 1.0, carbsG: 21.5, fatG: 0.4,
    servingSize: '1 cup cooked', servingGrams: 180,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // STREET FOOD & SNACKS
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'samosa',
    name: 'Samosa',
    aliases: ['kenyan samosa', 'meat samosa', 'fried pastry'],
    category: 'Street Food',
    community: 'All Kenya (Asian influence)',
    calories: 140, proteinG: 4.5, carbsG: 15.0, fatG: 7.0,
    servingSize: '1 piece', servingGrams: 50,
  },
  {
    id: 'bhajia',
    name: 'Bhajia',
    aliases: ['potato bhajia', 'bhajias', 'kenyan bhajia', 'potato fritters'],
    category: 'Street Food',
    community: 'All Kenya / Coastal',
    calories: 175, proteinG: 3.5, carbsG: 22.0, fatG: 8.5,
    servingSize: '5 pieces', servingGrams: 80,
  },
  {
    id: 'chips',
    name: 'Chips',
    aliases: ['french fries', 'kenyan chips', 'fries'],
    category: 'Street Food',
    community: 'All Kenya',
    calories: 274, proteinG: 3.4, carbsG: 36.0, fatG: 13.5,
    servingSize: '1 serving', servingGrams: 100,
  },
  {
    id: 'chipsi-mayai',
    name: 'Chipsi Mayai',
    aliases: ['chips and eggs', 'chips omelette', 'egg chips'],
    category: 'Street Food',
    community: 'All Kenya',
    calories: 310, proteinG: 12.0, carbsG: 28.0, fatG: 17.0,
    servingSize: '1 serving', servingGrams: 200,
  },
  {
    id: 'mahindi-choma',
    name: 'Mahindi Choma',
    aliases: ['roast corn', 'grilled corn', 'roasted maize'],
    category: 'Street Food',
    community: 'All Kenya',
    calories: 125, proteinG: 4.0, carbsG: 27.0, fatG: 1.5,
    servingSize: '1 cob', servingGrams: 130,
  },
  {
    id: 'groundnuts',
    name: 'Njugu Karanga',
    aliases: ['groundnuts', 'roasted peanuts', 'peanuts', 'karanga'],
    category: 'Snacks',
    community: 'All Kenya',
    calories: 585, proteinG: 25.0, carbsG: 16.0, fatG: 49.0,
    servingSize: '1 handful', servingGrams: 30,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // PORRIDGES & BREAKFAST
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'uji-mahindi',
    name: 'Uji wa Mahindi',
    aliases: ['maize porridge', 'corn porridge', 'uji', 'fermented porridge'],
    category: 'Porridges',
    community: 'All Kenya',
    calories: 55, proteinG: 1.2, carbsG: 12.5, fatG: 0.3,
    servingSize: '1 cup', servingGrams: 240,
  },
  {
    id: 'uji-wimbi',
    name: 'Uji wa Wimbi',
    aliases: ['millet porridge', 'finger millet porridge', 'wimbi porridge'],
    category: 'Porridges',
    community: 'All Kenya / Western',
    calories: 70, proteinG: 2.0, carbsG: 15.0, fatG: 0.8,
    servingSize: '1 cup', servingGrams: 240,
  },
  {
    id: 'maziwa-mala',
    name: 'Maziwa Mala',
    aliases: ['fermented milk', 'sour milk', 'cultured milk', 'mala'],
    category: 'Dairy',
    community: 'All Kenya / Maasai',
    calories: 61, proteinG: 3.4, carbsG: 4.8, fatG: 3.3,
    servingSize: '1 cup', servingGrams: 240,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // DRINKS
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'chai-maziwa',
    name: 'Chai',
    aliases: ['kenyan tea', 'milk tea', 'masala chai', 'kenyan chai', 'spiced tea'],
    category: 'Drinks',
    community: 'All Kenya',
    calories: 75, proteinG: 2.5, carbsG: 10.5, fatG: 2.5,
    servingSize: '1 cup (with milk and sugar)', servingGrams: 240,
  },
  {
    id: 'chai-black',
    name: 'Chai Rangi',
    aliases: ['black tea', 'plain tea', 'tea without milk'],
    category: 'Drinks',
    community: 'All Kenya',
    calories: 20, proteinG: 0.0, carbsG: 5.0, fatG: 0.0,
    servingSize: '1 cup with sugar', servingGrams: 240,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // SALADS & CONDIMENTS
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'kachumbari',
    name: 'Kachumbari',
    aliases: ['kenyan salad', 'tomato onion salad', 'fresh salsa'],
    category: 'Salads',
    community: 'All Kenya',
    calories: 22, proteinG: 1.0, carbsG: 4.5, fatG: 0.2,
    servingSize: '2 tablespoons', servingGrams: 50,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // EGGS
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'mayai-fried',
    name: 'Mayai ya Kukaanga',
    aliases: ['fried eggs', 'eggs fried'],
    category: 'Eggs & Dairy',
    community: 'All Kenya',
    calories: 185, proteinG: 12.5, carbsG: 1.0, fatG: 14.5,
    servingSize: '2 eggs fried', servingGrams: 100,
  },
  {
    id: 'mayai-boiled',
    name: 'Mayai ya Kuchemsha',
    aliases: ['boiled eggs', 'hard boiled egg'],
    category: 'Eggs & Dairy',
    community: 'All Kenya',
    calories: 155, proteinG: 12.5, carbsG: 1.1, fatG: 10.5,
    servingSize: '2 eggs boiled', servingGrams: 100,
  },
]

// ──────────────────────────────────────────────────────────────────────────
// Search function — searches name and all aliases
// ──────────────────────────────────────────────────────────────────────────
export function searchLocalFoods(query: string): LocalFood[] {
  const q = query.toLowerCase().trim()
  if (!q || q.length < 1) return []

  return KENYAN_FOODS
    .filter(food => {
      const inName = food.name.toLowerCase().includes(q)
      const inAliases = food.aliases.some(a => a.toLowerCase().includes(q))
      const inCategory = food.category.toLowerCase().includes(q)
      const inCommunity = food.community.toLowerCase().includes(q)
      return inName || inAliases || inCategory || inCommunity
    })
    .slice(0, 8)
}
