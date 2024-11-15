const express = require('express');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const app = express();
const port = 8802;

// Middleware to parse URL-encoded and JSON bodies
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

// Load map data from maps.csv
let mapsData = [];
fs.createReadStream('data/maps.csv')
  .pipe(csv())
  .on('data', (row) => {
    mapsData.push(row);
  })
  .on('end', () => {
    console.log('Maps data loaded successfully.');

    // Now that mapsData is loaded, initialize responseCounts
    initializeResponseCounts();

    // Start the server after data is loaded and responseCounts is initialized
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  });

// Function to initialize responseCounts
function initializeResponseCounts() {
  const responseCountsPath = 'data/response_counts.json';
  let responseCounts = {};
  if (fs.existsSync(responseCountsPath)) {
    responseCounts = JSON.parse(fs.readFileSync(responseCountsPath));
  } else {
    mapsData.forEach((map) => {
      responseCounts[map.URL] = 0;
    });
    fs.writeFileSync(responseCountsPath, JSON.stringify(responseCounts, null, 2));
  }

  // Store responseCounts globally
  app.locals.responseCounts = responseCounts;
}

// Endpoint to get maps data
app.get('/get_maps', (req, res) => {
  const responseCounts = app.locals.responseCounts;

  // Filter maps that have less than 20 responses
  const availableMaps = mapsData.filter((map) => {
    return (responseCounts[map.URL] || 0) < 20;
  });

  if (availableMaps.length === 0) {
    res.json({ done: true });
  } else {
    // Send one random map from the available maps
    const randomMap =
      availableMaps[Math.floor(Math.random() * availableMaps.length)];
    res.json({ done: false, map: randomMap });
  }
});

// Handle form submissions
app.post('/submit', (req, res) => {
  const data = req.body;
  const responseCounts = app.locals.responseCounts;

  // Append the form data to collected_data.csv
  const output =
    [
      data.Question,
      data.Map,
      data['Question Type'],
      data['Map Category'],
      data['Quasi Logical Expression'],
      data['Expression Complexity'],
      data['Correct Answer'],
    ]
      .map((value) => `"${(value || '').replace(/"/g, '""')}"`) // Handle commas and quotes in CSV
      .join(',') + '\n';

  fs.appendFile(collectedDataPath, output, (err) => {
    if (err) {
      console.error('Error writing to collected_data.csv:', err);
      res.status(500).send('Internal Server Error');
    } else {
      // Update response count
      responseCounts[data.Map] = (responseCounts[data.Map] || 0) + 1;
      fs.writeFileSync(
        'data/response_counts.json',
        JSON.stringify(responseCounts, null, 2)
      );
      res.send('Data submitted successfully');
    }
  });
});

// Ensure collected_data.csv exists and has headers
const collectedDataPath = 'data/collected_data.csv';
if (!fs.existsSync(collectedDataPath)) {
  const headers = [
    'Question',
    'Map',
    'Question Type',
    'Map Category',
    'Quasi Logical Expression',
    'Expression Complexity',
    'Correct Answer',
  ];
  fs.writeFileSync(collectedDataPath, headers.join(',') + '\n');
}