var gaul = ee.FeatureCollection("FAO/GAUL/2015/level1")

var bounds = gaul.filter(ee.Filter.eq('ADM0_NAME', 'Ethiopia')) 
           .filter(ee.Filter.eq('ADM1_NAME', 'Afar'))


// Load the boundary FeatureCollection
//var bounds = ee.FeatureCollection("projects/ee-mussa-mohammed/assets/ZONE4");
var s1 = ee.ImageCollection("COPERNICUS/S1_GRD");
// Get the geometry of the bounds
var boundsGeometry = bounds.geometry();

// Zoom to bounds
Map.centerObject(bounds);

// Set map style
Map.setOptions('HYBRID');

// Years to analyze
var years = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];

// Property for wet and dry season
var props = [
  { name: 'wet', start: '-12-01', end: '-12-31', palette: 'navy' }, // Adjust wet season dates
  { name: 'dry', start: '-08-01', end: '-08-31', palette: 'lightskyblue' } // Adjust dry season dates
];

// Run per year
var images = ee.ImageCollection(years.map(function(year) {
  // Run for wet and dry season
  var imageSeasons = ee.Image(props.map(function(prop) {
    // Get minimum composite of Sentinel-1 collection
    var image = s1
      .filterBounds(boundsGeometry) // Filter to the boundary geometry
      .filterDate(year + prop.start, year + prop.end)
      .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV')) // Ensure VV polarization is available
      .select('VV'); // Only take VV bands

    var imageMin = image.reduce(ee.Reducer.percentile([10])) // Do minimum composite
      .clip(boundsGeometry) // Clip to the geometry
      .focalMean(50, 'square', 'meters'); // Speckle filtering

    // Show image
    Map.addLayer(imageMin, { min: -20, max: 0 }, 'S1 ' + year + ' ' + prop.name, false);

    // Get water mask from the image
    var water = imageMin.lt(-15).toByte().rename('water_' + prop.name);
    Map.addLayer(water.selfMask(), { palette: prop.palette }, 'Water ' + year + ' ' + prop.name, false);

    // Return water mask
    return ee.Image([water]);
  }));

  // Water permanent
  var waterWet = imageSeasons.select('water_wet');
  var waterDry = imageSeasons.select('water_dry');

  // Get flood from wet and dry season
  var flood = waterWet.and(waterDry.eq(0)).rename('flood').toByte();

  // Permanent water
  var allWater = waterDry.or(waterWet).rename('water');

  // Show flood
  Map.addLayer(flood.selfMask(), { palette: 'blue' }, 'Flood ' + year, false);

  // Calculate flood area
  var floodArea = ee.Number(ee.Image.pixelArea().multiply(1e-4).updateMask(flood).reduceRegion({
    scale: 100,
    geometry: boundsGeometry,
    reducer: ee.Reducer.sum(),
    maxPixels: 1e13
  }).get('area'));

  // Return water and flood area
  return ee.Image([flood.selfMask(), allWater]).set({
    year: String(year),
    year_num: year,
    flood_area: floodArea
  });
}));

// Mapping flood hazard from how often the flood happens every year
var floodHazard = images.select('flood').sum().divide(years.length);
Map.addLayer(floodHazard, { min: 0, max: 1, palette: ['white', 'pink', 'red'] }, 'floodHazard');

// Legend flood hazard
legendPanelGradient('Flood hazard index', { min: 0, max: 1, palette: ['white', 'pink', 'red'] }, 'bottom-left');

// Export the flood hazard map as a GeoTIFF
Export.image.toDrive({
  image: floodHazard,
  description: 'FloodHazardMap',
  fileNamePrefix: 'Flood_Hazard',
  region: bounds,
  scale: 1000, // Resolution in meters
  crs: 'EPSG:4326', // WGS84 coordinate system
  maxPixels: 1e13 // Adjust max pixels for large regions
});
// Permanent water
var waterPermanent = images.select('water').reduce(ee.Reducer.allNonZero()).and(floodHazard.mask().eq(0)).rename('water');
Map.addLayer(waterPermanent.selfMask(), { palette: 'blue' }, 'Permanent water');

// Legend permanent water
legendDiscrete(['Permanent water'], ['blue']);

// Show border
Map.addLayer(ee.Image().paint(bounds, 0, 2), { palette: 'red' }, 'Boundary');

// Calculate flood area per year in chart
var chart = ui.Chart.feature.byFeature(images, 'year', ['flood_area'])
  .setChartType('ColumnChart')
  .setOptions({
    title: 'Flood Area (Ha) 2017 - 2024',
    vAxis: { title: 'Flood area (Ha)' },
    hAxis: { title: 'Year' },
    series: {
      0: { color: 'lightskyblue' }
    }
  });
print(chart);

// Legend discrete
function legendDiscrete(names, palette) {
  var legend = ui.Panel([], ui.Panel.Layout.flow('vertical'), { position: 'bottom-left' });
  names.map(function(name, index) {
    legend.add(ui.Panel([
      ui.Label('', { width: '30px', height: '15px', backgroundColor: palette[index], border: 'thin solid black' }),
      ui.Label(name)
    ], ui.Panel.Layout.flow('horizontal')));
  });
  Map.add(legend);
}

// Gradient Legend Function
function legendPanelGradient(name, vis, position) {
  // Create a panel for the legend
  var panel = ui.Panel({
    style: {
      position: position,
      padding: '8px',
      backgroundColor: 'white'
    }
  });

  // Add the title
  var title = ui.Label({
    value: name,
    style: {
      fontWeight: 'bold',
      fontSize: '14px',
      margin: '0 0 4px 0',
      textAlign: 'center'
    }
  });
  panel.add(title);

  // Add the gradient bar
  var gradient = ui.Thumbnail({
    image: ee.Image.pixelLonLat()
      .select('latitude')
      .resample('bilinear')
      .visualize(vis),
    params: { dimensions: '100x20' },
    style: { stretch: 'horizontal', margin: '0 0 4px 0' }
  });
  panel.add(gradient);

  // Add min and max labels
  var labels = ui.Panel({
    widgets: [
      ui.Label(String(vis.min), { margin: '0 4px 0 0', textAlign: 'left' }),
      ui.Label(String(vis.max), { margin: '0 0 0 4px', textAlign: 'right' })
    ],
    layout: ui.Panel.Layout.flow('horizontal')
  });
  panel.add(labels);

  // Add the legend to the map
  Map.add(panel);
}


// Load LULC dataset (ESA WorldCover 2020 as an example)
var lulc = ee.Image('ESA/WorldCover/v100/2020')
  .clip(boundsGeometry); // Clip to the bounds

// Add LULC to the map
Map.addLayer(lulc, { min: 10, max: 100, palette: ['006400', 'ffbb22', 'ffff4c', 'f096ff', 'fa0000', 'b4b4b4', 'f0f0f0', '0064c8', '0096a0', '00cf75'] }, 'LULC 2020');

// Flood hazard (from previous analysis)
var floodHazard = images.select('flood').sum().divide(years.length);

// Overlay flood hazard with LULC
var floodLULC = floodHazard.updateMask(floodHazard).addBands(lulc);

// Get LULC class names and codes
var lulcClasses = [
  { name: 'Tree Cover', code: 10 },
  { name: 'Shrubland', code: 20 },
  { name: 'Grassland', code: 30 },
  { name: 'Cropland', code: 40 },
  { name: 'Built-up', code: 50 },
  { name: 'Bare/Sparse Vegetation', code: 60 },
  { name: 'Permanent Water Bodies', code: 80 },
  { name: 'Herbaceous Wetland', code: 90 }
];

// Calculate flood area per LULC type
var floodAreaByLULC = lulcClasses.map(function(lulcClass) {
  // Mask for the current LULC class
  var classMask = floodLULC.select('Map').eq(lulcClass.code);
  
  // Calculate flood area for this LULC class
  var floodArea = floodLULC.updateMask(classMask).reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: boundsGeometry,
    scale: 100,
    maxPixels: 1e13
  }).get('flood'); // Use the correct band name for the flood layer
  
  // Handle cases where flood area is null
  floodArea = ee.Algorithms.If(floodArea, ee.Number(floodArea).multiply(1e-4), 0); // Convert m² to hectares or set to 0
  
  return {
    LULC: lulcClass.name,
    FloodArea: floodArea
  };
});

// Convert results to a FeatureCollection for display and export
var floodAreaTable = ee.FeatureCollection(
  floodAreaByLULC.map(function(item) {
    return ee.Feature(null, {
      LULC: ee.String(item.LULC),
      FloodArea: ee.Number(item.FloodArea)
    });
  })
);

// Print results
print('Flood Area by LULC', floodAreaTable);

// Export results as CSV
Export.table.toDrive({
  collection: floodAreaTable,
  description: 'FloodAreaByLULC',
  fileFormat: 'CSV'
});

// Display on map
Map.addLayer(floodHazard, { min: 0, max: 1, palette: ['white', 'pink', 'red'] }, 'Flood Hazard');
// Load population layer (use 2015 baseline or newer datasets if available)
var population = ee.Image("JRC/GHSL/P2016/POP_GPW_GLOBE_V1/2015")
  .select('population_count');

// Loop over each year
var yearlyExposures = years.map(function(year) {
  // Get flood image for the year (already computed)
  var floodImg = ee.Image(images.filter(ee.Filter.eq('year_num', year)).first())
    .select('flood');

  // Calculate exposed population: mask pop image to flood pixels
  var floodedPop = population.updateMask(floodImg);

  // Sum population over flooded areas
  var popExposed = floodedPop.reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: boundsGeometry,
    scale: 100,  // Adjust based on your analysis needs
    maxPixels: 1e9
  }).get('population_count');

  // Return dictionary with year and population
  return ee.Feature(null, {
    year: year,
    population_exposed: popExposed
  });
});

// Convert to FeatureCollection
var exposureFC = ee.FeatureCollection(yearlyExposures);

// Chart: People exposed to floods per year
var chart = ui.Chart.feature.byFeature(exposureFC, 'year', ['population_exposed'])
  .setChartType('ColumnChart')
  .setOptions({
    title: 'Population Exposed to Floods (per Year)',
    vAxis: { title: 'People Exposed' },
    hAxis: { title: 'Year' },
    series: {
      0: { color: 'red' }
    }
  });

print(chart);
