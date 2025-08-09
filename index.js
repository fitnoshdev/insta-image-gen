const { GoogleGenAI, Modality } = require("@google/genai");
const fs = require("fs");
const { createCanvas, loadImage, registerFont } = require('canvas');
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Enable CORS for n8n integration
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

require('dotenv').config();

// Global variable to track font registration status
let fontRegistered = false;

// Register system fonts for better cross-platform compatibility
try {
  // Try to register a system font that works well on both local and server
  // These are commonly available fonts on most systems
  const fontPaths = [
    '/System/Library/Fonts/Arial.ttf', // macOS
    '/System/Library/Fonts/Helvetica.ttc', // macOS
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', // Linux
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', // Common Linux
    '/usr/share/fonts/TTF/arial.ttf', // Some Linux distributions
    'C:\\Windows\\Fonts\\arial.ttf', // Windows
    'C:\\Windows\\Fonts\\calibri.ttf', // Windows
  ];
  
  // Use the global fontRegistered variable
  for (const fontPath of fontPaths) {
    try {
      if (fs.existsSync(fontPath)) {
        registerFont(fontPath, { family: 'BrandFont' });
        console.log(`Registered font: ${fontPath}`);
        fontRegistered = true;
        break;
      }
    } catch (err) {
      console.log(`Failed to register font ${fontPath}:`, err.message);
    }
  }
  
  if (!fontRegistered) {
    console.log('No system fonts found, will use canvas default fonts');
  }
} catch (error) {
  console.log('Font registration failed, using default fonts:', error.message);
}

// Use environment variable for API key (more secure)
const API_KEY = process.env.GOOGLE_API_KEY || "AIzaSyAK-9qM4SPrtQnpcd7OdnvYuztFmRU_pRc";
const genAI = new GoogleGenAI(API_KEY);

// Health check endpoint for n8n and monitoring
app.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'fitnosh-instagram-generator',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    endpoints: {
      'POST /generate-image': 'Generate Instagram image with meal data',
      'GET /images': 'List all generated images',
      'GET /images/:filename': 'View specific image',
      'GET /health': 'Detailed health check'
    }
  });
});

// Detailed health check endpoint for n8n monitoring
app.get('/health', (req, res) => {
  const healthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    service: 'fitnosh-instagram-generator',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'production',
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
    },
    api_key_configured: !!process.env.GOOGLE_API_KEY,
    logo_file_exists: require('fs').existsSync('./street_nosh_logo.png'),
    ready: true
  };

  res.status(200).json(healthCheck);
});

// Simple ping endpoint for keep-alive
app.get('/ping', (req, res) => {
  res.status(200).json({ 
    status: 'pong', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Function to clean up old image files (keep only last 10)
function cleanupOldImages() {
  try {
    const imageFiles = fs.readdirSync('.')
      .filter(file => file.match(/^\w+-meals-\d+-[a-f0-9]+\.png$/)) // Match our new naming pattern
      .map(file => ({
        name: file,
        time: fs.statSync(file).mtime
      }))
      .sort((a, b) => b.time - a.time); // Sort by modification time, newest first
    
    // Keep only the 10 most recent images, delete the rest
    if (imageFiles.length > 10) {
      const filesToDelete = imageFiles.slice(10);
      filesToDelete.forEach(file => {
        try {
          fs.unlinkSync(file.name);
          console.log(`Cleaned up old image: ${file.name}`);
        } catch (err) {
          console.log(`Failed to delete ${file.name}:`, err.message);
        }
      });
    }
  } catch (error) {
    console.log('Error during cleanup:', error.message);
  }
}

async function addLogoAndLabels(imagePath, meal) {
  try {
    // Clean up old images before creating new one
    cleanupOldImages();
    
    // Load the generated food image
    const baseImage = await loadImage(imagePath);
    
    // Create canvas with same dimensions and high quality settings
    const canvas = createCanvas(baseImage.width, baseImage.height);
    const ctx = canvas.getContext('2d');
    
    // Set high quality rendering options
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.textRenderingOptimization = 'optimizeQuality';
    
    // Draw the base food image
    ctx.drawImage(baseImage, 0, 0);
    
    // Define logo position variables at function scope
    const logoSize = 250; 
    const logoX = 30;
    const logoY = 30;
    
    // Load and overlay the real Street Nosh logo
    try {
      console.log('Loading Street Nosh logo: street_nosh_logo.png');
      console.log('Current working directory:', process.cwd());
      console.log('Files in directory:', require('fs').readdirSync('.'));
      
      const logo = await loadImage('street_nosh_logo.png');
      console.log('Logo loaded successfully:', logo.width, 'x', logo.height);
      
      // Draw the real logo
      ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
      console.log(`Real logo placed at position: ${logoX}, ${logoY} with size: ${logoSize}`);
      
    } catch (logoError) {
      console.error('Error loading logo file:', logoError.message);
      console.log('Current working directory:', process.cwd());
      console.log('Files in directory:', require('fs').readdirSync('.'));
      console.log('Skipping logo - will leave space empty for external logo overlay');
      
      // Don't create any placeholder - leave the space empty as intended
      // The AI prompt already instructs to leave this space clear for logo placement
    }
    
    // Set up text styling for dish labels with comprehensive font fallbacks
    // Use registered font or comprehensive fallbacks for cross-platform compatibility
    const fontStack = 'bold 32px BrandFont, Arial, "Helvetica Neue", Helvetica, "Liberation Sans", "DejaVu Sans", Verdana, Geneva, Tahoma, sans-serif';
    ctx.font = fontStack;
    
    // Test font rendering to ensure it's working
    const testMetrics = ctx.measureText('Test');
    if (testMetrics.width === 0) {
      // Fallback to a very basic font if measurement fails
      ctx.font = 'bold 32px monospace';
      console.log('Using monospace fallback font');
    }
    
    ctx.fillStyle = '#FDCF16'; // Yellow color matching brand
    // Remove borders/outlines for clean text
    ctx.strokeStyle = 'transparent';
    ctx.lineWidth = 0;
    ctx.shadowColor = 'transparent';
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.shadowBlur = 0;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    // Enable font smoothing for better quality
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    // Define text positions for dish labels - positioned below the logo
    const logoBottom = logoY + logoSize; // Logo Y position + logo size
    const textPositions = [
      { x: logoX, y: logoBottom + 40 },   // Breakfast position (below logo)
      { x: logoX, y: logoBottom + 80 },   // Snack position (below breakfast)
      { x: logoX, y: logoBottom + 120 }   // Lunch position (below snack)
    ];
    
    const dishes = [
      meal.Breakfast,
      meal.Snack,
      meal.Lunch
    ];
    
    // Draw each dish name
    dishes.forEach((dish, index) => {
      if (dish && textPositions[index]) {
        const pos = textPositions[index];
        
        // Draw text without borders/outlines
        ctx.fillText(dish, pos.x, pos.y);
        
        console.log(`Added label "${dish}" at position ${pos.x}, ${pos.y}`);
      }
    });
    
    // Generate unique filename with timestamp and random string for cache busting
    const timestamp = Date.now();
    const randomId = crypto.randomBytes(8).toString('hex');
    const finalImagePath = `${meal.Day.toLowerCase()}-meals-${timestamp}-${randomId}.png`;
    
    // Save with high quality PNG settings
    const buffer = canvas.toBuffer('image/png', { compressionLevel: 3, filters: canvas.PNG_FILTER_NONE });
    fs.writeFileSync(finalImagePath, buffer);
    
    console.log(`Final branded and labeled image saved as ${finalImagePath}`);
    return finalImagePath;
    
  } catch (error) {
    console.error('Error adding logo and labels:', error);
    return imagePath;
  }
}

async function generateMealImage(mealData = null) {
  // Default meal data
  const defaultMeal = {
    "Day": "Tuesday",
    "Breakfast": "Smoothie Bowl + Granola",
    "Snack": "Mixed Nuts + Dates",
    "Lunch": "Millet Roti + Mixed Veg Curry"
  };

  let meal = defaultMeal;
  
  try {
    // Handle different input formats
    if (mealData) {
      if (Array.isArray(mealData) && mealData.length > 0) {
        meal = mealData[0];
      } else if (typeof mealData === 'object') {
        meal = mealData;
      }
    }
    
    // Ensure all required fields exist with fallbacks
    meal = {
      Day: meal.Day || defaultMeal.Day,
      Breakfast: meal.Breakfast || defaultMeal.Breakfast,
      Snack: meal.Snack || defaultMeal.Snack,
      Lunch: meal.Lunch || defaultMeal.Lunch
    };
    
    console.log('Final meal data:', meal);
  } catch (error) {
    console.error('Error processing meal data, using defaults:', error);
    meal = defaultMeal;
  }
  const contents = `Generate a professional Instagram food photography image:

FOOD COMPOSITION:
- Breakfast: ${meal.Breakfast}
- Snack: ${meal.Snack}  
- Lunch: ${meal.Lunch}

SPACE FOR LOGO:
- Leave completely clear, empty space in the TOP LEFT corner
- No text, food items, decorations, or any elements in this area
- Ensure plain dark background in top left corner
- This space is reserved for external logo placement

VISUAL STYLE:
- Professional food photography with perfect focus and sharp details
- Natural lighting with studio-quality setup
- Flat lay arrangement on dark black background
- Vibrant, appetizing colors with high contrast
- Clean, modern composition
- Each food item clearly visible and beautifully presented
- ASPECT RATIO: 1:1 (Instagram square format)
- Square composition optimized for Instagram posts
- No Borders 

COLORS TO USE:
- Incorporate vibrant yellow (#FDCF16) accent elements:
  * Yellow napkins, utensils, or small containers
  * Yellow garnishes or accent elements
  * Yellow packaging details (NO TEXT OR LOGOS)
- Use black plates, bowls, and serving elements
- Dark background for dramatic contrast

FOOD PRESENTATION:
- ${meal.Day} Indian street food aesthetic
- Premium, restaurant-quality plating
- Authentic Indian flavors and ingredients visible
- Street food style but elevated presentation
- Leave space in top-left area for logo overlay
- CRITICAL: Leave clear margins around edges for text labels:
  * Bottom 15% of image should have minimal food items for text space
  * Top right corner should have some empty dark background
  * Arrange food items in center-focused composition
  * Ensure adequate negative space around food for text overlay

ABSOLUTELY CRITICAL - NO BRANDING IN AI GENERATION:
- Generate ONLY pure food photography
- NO logos, text, labels, branding, or written elements ANYWHERE
- NO Street Nosh logos or any other brand logos
- NO decorative text or graphic elements
- NO company names or brand references
- NO borders, frames, or decorative elements around the image
- NO yellow borders or colored frames
- Just clean food photography with plain dark background
- All branding will be added externally as overlay`;

  // Add randomization to ensure different images each time
  const randomSeed = Math.floor(Math.random() * 10000);
  const enhancedContents = contents + `

VARIATION REQUIREMENTS:
- Generate a unique composition each time
- Vary the arrangement and styling 
- Different camera angles and food placement
- Unique presentation style
- Random seed: ${randomSeed}
- Timestamp: ${new Date().toISOString()}`;

  console.log("Generating image for:", meal.Day);
  console.log("Random seed:", randomSeed);
  console.log("Prompt:", enhancedContents);

  // Set responseModalities to include "Image" so the model can generate an image
  let response;
  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    try {
      response = await genAI.models.generateContent({
        model: "gemini-2.0-flash-preview-image-generation",
        contents: enhancedContents,
        config: {
          responseModalities: [Modality.TEXT, Modality.IMAGE],
        },
      });
      break; // Success, exit retry loop
    } catch (error) {
      attempts++;
      console.log(`Attempt ${attempts} failed:`, error.message);
      if (attempts < maxAttempts) {
        console.log(`Retrying in 5 seconds... (${attempts}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        throw error; // Re-throw if all attempts failed
      }
    }
  }

  for (const part of response.candidates[0].content.parts) {
    if (part.text) {
      console.log(part.text);
    } else if (part.inlineData) {
      const imageData = part.inlineData.data;
      const buffer = Buffer.from(imageData, "base64");
      const tempFilename = `temp-${meal.Day.toLowerCase()}-base.png`;
      fs.writeFileSync(tempFilename, buffer);
      console.log(`Base food image generated`);
      
      // Add real logo and dish labels
      const finalImagePath = await addLogoAndLabels(tempFilename, meal);
      
      // Clean up temporary file
      fs.unlinkSync(tempFilename);
      console.log(`Temporary file cleaned up`);
      
      return finalImagePath;
    }
  }
}

app.post('/generate-image', async (req, res) => {
  try {
    const mealData = req.body;
    const imagePath = await generateMealImage(mealData);
    
    const baseUrl = 'https://n8n-iw8n.onrender.com';
    
    // Add cache-busting query parameter to ensure fresh images
    const cacheBuster = Date.now();
    
    res.json({
      message: 'Image generated successfully',
      imagePath: imagePath,
      imageUrl: `${baseUrl}/images/${imagePath}?v=${cacheBuster}`,
      imageDisplayUrl: `${baseUrl}/images/${imagePath}?v=${cacheBuster}`,
      directLink: `${baseUrl}/images/${imagePath}?v=${cacheBuster}`,
      timestamp: new Date().toISOString(),
      uniqueId: imagePath.split('-').slice(-2).join('-').replace('.png', '') // Extract timestamp-randomid part
    });
  } catch (error) {
    console.error('Error generating image:', error);
    res.status(500).json({ 
      error: 'Error generating image',
      details: error.message
    });
  }
});

// Serve generated images with proper headers for n8n display
app.get('/images/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = `./${filename}`;
  
  if (fs.existsSync(filepath)) {
    // Set proper headers for image display with no cache to ensure fresh images
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'no-cache, no-store, must-revalidate', // Force fresh images
      'Pragma': 'no-cache',
      'Expires': '0',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.sendFile(filepath, { root: __dirname });
  } else {
    res.status(404).json({ error: 'Image not found', filename: filename });
  }
});

// List all generated images
app.get('/images', (req, res) => {
  const imageFiles = fs.readdirSync('.')
    .filter(file => file.match(/^\w+-meals-\d+-[a-f0-9]+\.png$/)) // Match our new naming pattern
    .map(file => ({
      filename: file,
      time: fs.statSync(file).mtime,
      size: fs.statSync(file).size
    }))
    .sort((a, b) => b.time - a.time); // Sort by newest first
  
  const baseUrl = req.get('host').includes('localhost') ? 
    `http://localhost:${port}` : 
    'https://n8n-iw8n.onrender.com';
  
  res.json({
    images: imageFiles.map(file => ({
      filename: file.filename,
      url: `${baseUrl}/images/${file.filename}`,
      created: file.time,
      size: file.size
    })),
    total: imageFiles.length
  });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  console.log(`Image generation API: POST http://localhost:${port}/generate-image`);
  console.log(`View images: GET http://localhost:${port}/images`);
  console.log(`View specific image: GET http://localhost:${port}/images/filename.png`);
});

// Run the function directly when script is executed
if (require.main === module) {
  generateMealImage().catch(console.error);
}