const { GoogleGenAI, Modality } = require("@google/genai");
const fs = require("fs");
const { createCanvas, loadImage } = require('canvas');
const express = require('express');
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

async function addLogoAndLabels(imagePath, meal) {
  try {
    // Load the generated food image
    const baseImage = await loadImage(imagePath);
    
    // Create canvas with same dimensions
    const canvas = createCanvas(baseImage.width, baseImage.height);
    const ctx = canvas.getContext('2d');
    
    // Draw the base food image
    ctx.drawImage(baseImage, 0, 0);
    
    // Define logo position variables at function scope
    const logoSize = 250; 
    const logoX = 30;
    const logoY = 30;
    
    // Load and overlay the real Street Nosh logo
    try {
      console.log('Loading Street Nosh logo: street_nosh_logo.png');
      const logo = await loadImage('street_nosh_logo.png');
      console.log('Logo loaded successfully:', logo.width, 'x', logo.height);
      
      // Draw the real logo
      ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
      console.log(`Real logo placed at position: ${logoX}, ${logoY} with size: ${logoSize}`);
      
    } catch (logoError) {
      console.error('Error loading logo file:', logoError.message);
      console.log('Creating placeholder logo area instead');
      
      // Create a placeholder logo area with brand colors
      ctx.fillStyle = '#FDCF16'; // Yellow brand color
      ctx.fillRect(logoX, logoY, logoSize, logoSize);
      
      // Add "FITNOSH" text as placeholder
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 32px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('FITNOSH', logoX + logoSize/2, logoY + logoSize/2);
      
      console.log(`Placeholder logo created at position: ${logoX}, ${logoY} with size: ${logoSize}`);
    }
    
    // Set up text styling for dish labels
    ctx.font = 'bold 24px "Comic Sans MS", cursive'; // Using Comic Sans as fallback for Chloe-like style
    ctx.fillStyle = '#FDCF16'; // Yellow color matching brand
    ctx.strokeStyle = '#000000'; // Black outline for contrast
    ctx.lineWidth = 3;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
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
        
        // Draw text stroke (outline)
        ctx.strokeText(dish, pos.x, pos.y);
        // Draw text fill
        ctx.fillText(dish, pos.x, pos.y);
        
        console.log(`Added label "${dish}" at position ${pos.x}, ${pos.y}`);
      }
    });
    
    // Save the final branded and labeled image
    const finalImagePath = `${meal.Day.toLowerCase()}-meals.png`;
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(finalImagePath, buffer);
    
    console.log(`Final branded and labeled image saved as ${finalImagePath}`);
    return finalImagePath;
    
  } catch (error) {
    console.error('Error adding logo and labels:', error);
    return imagePath;
  }
}

async function generateMealImage(mealData = null) {
  // Use provided meal data or default data
  const defaultMealData = [
    {
      "row_number": 2,
      "Day": "Tuesday",
      "Breakfast": "Smoothie Bowl + Granola",
      "Snack": "Mixed Nuts + Dates",
      "Lunch": "Millet Roti + Mixed Veg Curry"
    }
  ];

  const meals = mealData || defaultMealData;
  // Extract the first meal plan and create a proper prompt
  const meal = meals[0];
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
- Just clean food photography with plain dark background
- All branding will be added externally as overlay`;

  console.log("Generating image for:", meal.Day);
  console.log("Prompt:", contents);

  // Set responseModalities to include "Image" so the model can generate an image
  let response;
  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    try {
      response = await genAI.models.generateContent({
        model: "gemini-2.0-flash-preview-image-generation",
        contents: contents,
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
    
    // Simple, reliable URL generation
    const baseUrl = 'https://n8n-iw8n.onrender.com';
    
    res.json({
      message: 'Image generated successfully',
      imagePath: imagePath,
      imageUrl: `${baseUrl}/images/${imagePath}`,
      imageDisplayUrl: `${baseUrl}/images/${imagePath}`,
      directLink: `${baseUrl}/images/${imagePath}`
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
    // Set proper headers for image display
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
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
  const imageFiles = fs.readdirSync('.').filter(file => 
    file.endsWith('-meals.png') || file.endsWith('-meals-image.png')
  );
  res.json({
    images: imageFiles.map(file => ({
      filename: file,
      url: `http://localhost:${port}/images/${file}`
    }))
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