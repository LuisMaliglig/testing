import React, { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useNavigate } from "react-router-dom";
import transitRoute from "../data/transit-lines.json"; // Ensure path is correct
import { awsConfig } from "../config/config"; // Ensure path is correct
import logo from "../assets/logo.png"; // Ensure path is correct
import * as turf from "@turf/turf"; // Import turf for bounding box

// Define modeColors (needed for Legend and potentially getRouteColor)
const modeColors = {
    MRT: "#facc15", // Yellow-400
    LRT1: "#22c55e", // Green-500
    LRT2: "#7A07D1", // Purple
    LRT: "#22c55e",   // Fallback LRT
    Jeep: "#FFA500", // Orange
    "P2P-Bus": "#f97316", // Orange-500
    Bus: "#3b82f6", // Blue-500
    // Colors for stops if needed, can be same as line
    "MRT-Stop": "#facc15",
    "LRT1-Stop": "#22c55e",
    "LRT2-Stop": "#7A07D1",
    "Bus-Stop": "#3b82f6",
    "P2P-Bus-Stop": "#f97316", // Assuming specific P2P stops might exist
    // Walk/Driving colors not needed for layers here
};

// Define initial map center state
const INITIAL_MAP_CENTER = { lng: 120.995, lat: 14.53848 }; 
const INITIAL_MAP_ZOOM = 11;
// Define proximity threshold for showing stops along a selected line
const MAX_STOP_DISTANCE_TO_LINE_KM = 0.01; // 50 meters

const MapView = () => {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [nearestRoutes, setNearestRoutes] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [markerCenter, setMarkerCenter] = useState(INITIAL_MAP_CENTER); // Use constant for initial state
  const navigate = useNavigate();
  // Ensure vehicleFilters includes LRT1 and LRT2 if they exist as types
  const [vehicleFilters, setVehicleFilters] = useState({
    MRT: true,
    LRT1: true,
    LRT2: true,
    Jeep: true,
    "P2P-Bus": true,
    Bus: true,
  });

  // --- Helper Functions ---
  const formatDistance = (km) => {
    if (typeof km !== 'number' || isNaN(km)) return 'N/A';
    return km < 1 ? `${(km * 1000).toFixed(0)} m` : `${km.toFixed(2)} km`;
  };

  const formatWalkingTime = (km) => {
     if (typeof km !== 'number' || isNaN(km) || km < 0) return '? min';
    const minutes = Math.round((km / 5) * 60); // Assumes 5 km/h walking speed
    return `${minutes} min`;
  };

  // --- Effects for Fonts ---
  useEffect(() => {
    // Add Material Icons font link if not present
    const iconsLink = document.getElementById('material-icons-link');
    if (!iconsLink) {
         const link = document.createElement('link');
         link.id = 'material-icons-link';
         link.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
         link.rel = 'stylesheet';
         document.head.appendChild(link);
         return () => {
             const addedLink = document.getElementById('material-icons-link');
             if (addedLink) document.head.removeChild(addedLink);
         };
    }
  }, []);

  useEffect(() => {
    // Add Montserrat font link if not present
    const montserratLink = document.getElementById('montserrat-link');
     if (!montserratLink) {
        const montserrat = document.createElement('link');
        montserrat.id = 'montserrat-link';
        montserrat.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600&display=swap';
        montserrat.rel = 'stylesheet';
        document.head.appendChild(montserrat);
        return () => {
            const addedLink = document.getElementById('montserrat-link');
            if (addedLink) document.head.removeChild(addedLink);
        };
     }
  }, []);

  // --- Map Update Helpers ---

  // Calculates the shifted center point based on sidebar offset
  const calculateShiftedCenter = useCallback((mapCenter) => {
      if (!mapRef.current) return null;
      try {
        const centerScreenPoint = mapRef.current.project(mapCenter);
        centerScreenPoint.x += 150; // Adjust if sidebar width changes
        return mapRef.current.unproject(centerScreenPoint);
      } catch (e) {
        console.error("Error calculating shifted center:", e);
        return null;
      }
  }, []); // Depends only on mapRef implicitly via closure

  // Calculates shortest distance from center point to any line segment of the coordinates - MEMOIZED
  const calculatePointToLineDistance = useCallback((coordinates, center) => {
    if (!Array.isArray(coordinates) || coordinates.length < 2 || !center) return Infinity;
    let minDistanceSq = Infinity;
    const cx = center.lng;
    const cy = center.lat;
    for (let i = 0; i < coordinates.length - 1; i++) {
        const p1 = coordinates[i]; const p2 = coordinates[i + 1];
         if (!Array.isArray(p1) || p1.length < 2 || typeof p1[0] !== 'number' || typeof p1[1] !== 'number' || !Array.isArray(p2) || p2.length < 2 || typeof p2[0] !== 'number' || typeof p2[1] !== 'number') { continue; }
        const x1 = p1[0], y1 = p1[1]; const x2 = p2[0], y2 = p2[1];
        const lenSq = (x2 - x1) ** 2 + (y2 - y1) ** 2;
        if (lenSq === 0) { const distSq = (cx - x1) ** 2 + (cy - y1) ** 2; if (distSq < minDistanceSq) minDistanceSq = distSq; continue; }
        let t = ((cx - x1) * (x2 - x1) + (cy - y1) * (y2 - y1)) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const closestX = x1 + t * (x2 - x1); const closestY = y1 + t * (y2 - y1);
        const distSq = (cx - closestX) ** 2 + (cy - closestY) ** 2;
        if (distSq < minDistanceSq) minDistanceSq = distSq;
    }
    const degreesPerKmLat = 1 / 111.32;
    const degreesPerKmLon = 1 / (111.32 * Math.cos(center.lat * Math.PI / 180));
    const avgDegreesPerKm = (degreesPerKmLat + degreesPerKmLon) / 2;
    // Avoid division by zero if avgDegreesPerKm is somehow 0
    return avgDegreesPerKm > 0 ? Math.sqrt(minDistanceSq) / avgDegreesPerKm : Infinity;
  }, []); // No dependencies needed

  // Updates the list of nearest routes based on the center point - MEMOIZED
  const updateNearestRoutes = useCallback((center) => {
    if (!center || typeof center.lng !== 'number' || typeof center.lat !== 'number') {
        console.error("Invalid center point provided to updateNearestRoutes:", center);
        return;
    }
    // console.log(`Updating nearest routes for center: ${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`);

    // Filter features based on filters and ensure they are lines
    const filteredFeatures = transitRoute.features.filter(feature => {
      const type = feature?.properties?.type;
      const mode = type?.replace('-Stop', '');
      return type && mode && vehicleFilters[mode] && !type.includes('-Stop') &&
             feature?.geometry?.type === 'LineString' &&
             feature?.geometry?.coordinates && Array.isArray(feature.geometry.coordinates);
    });

    // Calculate distances using point-to-line
    const distances = filteredFeatures.map((feature) => {
      let distance = Infinity;
      try {
          // Pass coordinates and center to the memoized distance function
          distance = calculatePointToLineDistance(feature.geometry.coordinates, center);
      } catch(e) { console.error(`Error calculating distance for ${feature?.properties?.name}:`, e); distance = Infinity; }
      return { ...feature, distance: (typeof distance === 'number' && !isNaN(distance)) ? distance : Infinity };
    });

    const validDistances = distances.filter(route => route.distance !== Infinity);
    const sortedRoutes = validDistances.sort((a, b) => a.distance - b.distance);
    setNearestRoutes(sortedRoutes.slice(0, 7)); // Update state
    // console.log(`Found ${sortedRoutes.slice(0, 7).length} nearest routes.`);
  }, [vehicleFilters, calculatePointToLineDistance]); // Dependencies: filters and the distance function

  // Handles map move end event - MEMOIZED
  const handleMapMoveEnd = useCallback(() => {
      if (!mapRef.current) return;
      // console.log("Map move ended.");
      const mapCenter = mapRef.current.getCenter();
      const shiftedCenter = calculateShiftedCenter(mapCenter);
      if (shiftedCenter) {
          setMarkerCenter({ lng: shiftedCenter.lng, lat: shiftedCenter.lat });
          updateNearestRoutes(shiftedCenter); // Call the memoized update function
      }
  }, [calculateShiftedCenter, updateNearestRoutes]); // Dependencies for handleMapMoveEnd


  // --- Map Initialization ---
  useEffect(() => {
    if (!mapContainerRef.current) return;

    let isMounted = true;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: `https://maps.geo.${awsConfig.region}.amazonaws.com/maps/v0/maps/${awsConfig.mapName}/style-descriptor?key=${awsConfig.apiKey}`,
      center: [markerCenter.lng, markerCenter.lat],
      zoom: INITIAL_MAP_ZOOM, // Use constant
    });
    mapRef.current = map;

    map.on("load", () => {
        if (!mapRef.current || !isMounted) return;
        console.log("Map loaded event fired.");
        // Add source
        if (!mapRef.current.getSource("transit-route")) {
            mapRef.current.addSource("transit-route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        }
        // Add layers
        addAllLayers(map);
        // Initial data load based on default filters
        updateMapDataSource();
        // Initial nearest routes calculation
        const initialCenter = map.getCenter();
        const initialShiftedCenter = calculateShiftedCenter(initialCenter);
        if (initialShiftedCenter) {
            if (isMounted) {
                setMarkerCenter({ lng: initialShiftedCenter.lng, lat: initialShiftedCenter.lat });
                updateNearestRoutes(initialShiftedCenter);
            }
        }
        // Attach the move end listener *after* initial setup
        map.on("moveend", handleMapMoveEnd);
        console.log("Map 'moveend' listener attached.");
    });

     map.on('error', (e) => console.error("MapLibre Error:", e));

    // Cleanup function
    return () => {
      isMounted = false;
      if (mapRef.current) {
        if (mapRef.current.isStyleLoaded()) { // Check if style is loaded before removing listener
             try { mapRef.current.off("moveend", handleMapMoveEnd); } catch (e) {/* ignore */}
        }
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  // Only run ONCE on mount. Filter/selection changes handled separately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Removed handleMapMoveEnd dependency - it's stable due to useCallback

  // --- Effect to Update Map Data/Visibility When Filters/Selection Change ---
  useEffect(() => {
    if (!mapRef.current || !mapRef.current.isStyleLoaded()) {
        // console.log("Map not ready for data/visibility update.");
        return;
    }
    updateMapDataSource();
    updateLayerVisibility();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoute, vehicleFilters]); // Rerun when selection or filters change


  // --- Map Update Helpers ---
  // Updates the GeoJSON data in the map source
  const updateMapDataSource = () => {
    if (!mapRef.current || !mapRef.current.getSource("transit-route")) return;

    let featuresToShow = [];
    if (selectedRoute) {
       // If a route is selected, show that route AND its corresponding stops
       if (selectedRoute.type === 'Feature' && selectedRoute.geometry?.type === 'LineString') {
           featuresToShow.push(selectedRoute); // Add the selected line

           // Find and add stops matching the selected route's mode AND are close to the line
           const selectedMode = selectedRoute.properties?.type; // e.g., "MRT", "Bus", "LRT1"
           if (selectedMode && !selectedMode.includes('-Stop')) {
               let stopTypesToFind = [`${selectedMode}-Stop`]; // e.g., "MRT-Stop"
               // Special case for Bus/P2P: Also include generic Bus-Stops
               if (selectedMode === 'Bus' || selectedMode === 'P2P-Bus') {
                   if (!stopTypesToFind.includes('Bus-Stop')) stopTypesToFind.push('Bus-Stop');
                   if (!stopTypesToFind.includes('P2P-Bus-Stop')) stopTypesToFind.push('P2P-Bus-Stop'); // If you have specific P2P stops
               }

               const relatedStops = transitRoute.features.filter(feature => {
                   // Check if it's a stop of the correct type
                   const isCorrectStopType = feature?.geometry?.type === 'Point' &&
                                             feature?.properties?.type &&
                                             stopTypesToFind.includes(feature.properties.type);
                   if (!isCorrectStopType) return false;

                   // Check proximity to the selected line
                   try {
                       // Ensure stop has valid coordinates
                       if (!Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length < 2) return false;
                       const stopPoint = turf.point(feature.geometry.coordinates);
                       const distanceToLine = turf.pointToLineDistance(stopPoint, selectedRoute.geometry, { units: 'kilometers' });
                       return distanceToLine <= MAX_STOP_DISTANCE_TO_LINE_KM;
                   } catch (e) {
                       console.error(`Error checking distance for stop ${feature?.properties?.name}:`, e);
                       return false; // Exclude if error occurs
                   }
               });

               featuresToShow.push(...relatedStops);
               // console.log(`Showing ${relatedStops.length} stops near selected line: ${selectedMode}`);
           }
       } else { console.warn("Selected route is not a valid GeoJSON LineString Feature:", selectedRoute); }
    } else {
      // Otherwise, show all features matching the current filters
      featuresToShow = transitRoute.features.filter(feature => {
        const type = feature?.properties?.type;
        const mode = type?.replace('-Stop', '');
        return type && mode && vehicleFilters[mode] && feature?.geometry;
      });
    }

    const newGeoJSON = { type: "FeatureCollection", features: featuresToShow };
    try {
        mapRef.current.getSource("transit-route")?.setData(newGeoJSON);
        // console.log(`Map source 'transit-route' updated with ${featuresToShow.length} features.`);
    } catch(e) { console.error("Error setting map source data:", e); }
  };

  const updateLayerVisibility = () => {
      if (!mapRef.current) return;
      const stopLayers = ["mrt-stops", "lrt1-stops", "lrt2-stops", "bus-stops", "p2p-bus-stops"];
      const lineLayers = ["mrt-line", "lrt1-line", "lrt2-line", "bus-lines", "p2p-bus-lines", "jeep-lines"];

      const safeSetLayoutProperty = (layerId, prop, value) => {
          if (mapRef.current?.getLayer(layerId)) {
              try { mapRef.current.setLayoutProperty(layerId, prop, value); }
              catch (e) { /* console.warn(`Could not set layout property '${prop}' for layer '${layerId}':`, e.message); */ }
          }
      };

      if (selectedRoute) {
          const selectedMode = selectedRoute.properties?.type;
          const isBusOrP2P = selectedMode === 'Bus' || selectedMode === 'P2P-Bus';

          // Hide ALL lines first, then show the selected one
          lineLayers.forEach(layerId => safeSetLayoutProperty(layerId, "visibility", "none"));
          const selectedLineLayerId = lineLayers.find(id => id.startsWith(selectedMode?.toLowerCase()));
          if (selectedLineLayerId) { safeSetLayoutProperty(selectedLineLayerId, "visibility", "visible"); }

          // Show only stops relevant to the selected line's mode (data source filtering handles which stops are available)
          // We just need to make sure the correct *layer* is visible
          stopLayers.forEach(layerId => {
              let showLayer = false;
              // Determine the stop type this layer represents (e.g., 'MRT-Stop')
              // Corrected logic to handle layer IDs like 'lrt1-stops'
              let layerMode = layerId.split('-')[0]; // mrt, lrt1, lrt2, bus, p2p
              if (layerMode === 'LRT') layerMode += layerId.split('-')[0].substring(3); // Append 1 or 2
              if (layerMode === 'P2P') layerMode = 'P2P-Bus'; // Normalize P2P
              layerMode = layerMode.toUpperCase();

              const layerStopType = `${layerMode}-Stop`; // MRT-Stop, LRT1-Stop, BUS-Stop etc.

              // Show if it matches the selected mode's stop type
              if (isBusOrP2P && (layerId === 'bus-stops' || layerId === 'p2p-bus-stops')) {
                  showLayer = true;
              } else if (layerId.startsWith(selectedMode?.toLowerCase())) { // Match MRT-stops, LRT1-stops etc.
                  showLayer = true;
              }
              safeSetLayoutProperty(layerId, "visibility", showLayer ? "visible" : "none");
          });

      } else {
          // Set visibility based on filters when nothing is selected
          safeSetLayoutProperty("mrt-stops", "visibility", vehicleFilters.MRT ? "visible" : "none");
          safeSetLayoutProperty("lrt1-stops", "visibility", vehicleFilters.LRT1 ? "visible" : "none");
          safeSetLayoutProperty("lrt2-stops", "visibility", vehicleFilters.LRT2 ? "visible" : "none");
          safeSetLayoutProperty("bus-stops", "visibility", (vehicleFilters.Bus || vehicleFilters['P2P-Bus']) ? "visible" : "none");
          safeSetLayoutProperty("p2p-bus-stops", "visibility", vehicleFilters['P2P-Bus'] ? "visible" : "none");

          safeSetLayoutProperty("mrt-line", "visibility", vehicleFilters.MRT ? "visible" : "none");
          safeSetLayoutProperty("lrt1-line", "visibility", vehicleFilters.LRT1 ? "visible" : "none");
          safeSetLayoutProperty("lrt2-line", "visibility", vehicleFilters.LRT2 ? "visible" : "none");
          safeSetLayoutProperty("bus-lines", "visibility", vehicleFilters.Bus ? "visible" : "none");
          safeSetLayoutProperty("p2p-bus-lines", "visibility", vehicleFilters['P2P-Bus'] ? "visible" : "none");
          safeSetLayoutProperty("jeep-lines", "visibility", vehicleFilters.Jeep ? "visible" : "none");
      }
  };


  // Adds all necessary layers to the map (call on load)
  const addAllLayers = (map) => {
        // Function to safely add layer
        const safeAddLayer = (layerConfig) => {
            if (!map.getLayer(layerConfig.id)) {
                try { map.addLayer(layerConfig); }
                catch (e) { console.error(`Failed to add layer '${layerConfig.id}':`, e); }
            }
        };
        // Define layer configurations including LRT1/LRT2 stops and P2P stops
        const layers = [
            { id: "mrt-line", type: "line", filter: ["==", ["get", "type"], "MRT"], paint: { "line-color": modeColors.MRT, "line-width": 4 } },
            { id: "lrt1-line", type: "line", filter: ["==", ["get", "type"], "LRT1"], paint: { "line-color": modeColors.LRT1, "line-width": 4 } },
            { id: "lrt2-line", type: "line", filter: ["==", ["get", "type"], "LRT2"], paint: { "line-color": modeColors.LRT2, "line-width": 4 } },
            { id: "jeep-lines", type: "line", filter: ["==", ["get", "type"], "Jeep"], paint: { "line-color": modeColors.Jeep, "line-width": 3, 'line-opacity': 0.7 } },
            { id: "p2p-bus-lines", type: "line", filter: ["==", ["get", "type"], "P2P-Bus"], paint: { "line-color": modeColors['P2P-Bus'], "line-width": 3 } },
            { id: "bus-lines", type: "line", filter: ["==", ["get", "type"], "Bus"], paint: { "line-color": modeColors.Bus, "line-width": 3 } },
            { id: "mrt-stops", type: "circle", filter: ["==", ["get", "type"], "MRT-Stop"], paint: { "circle-radius": 5, "circle-color": modeColors.MRT, "circle-stroke-color": "#fff", "circle-stroke-width": 1 } },
            { id: "lrt1-stops", type: "circle", filter: ["==", ["get", "type"], "LRT1-Stop"], paint: { "circle-radius": 5, "circle-color": modeColors.LRT1, "circle-stroke-color": "#fff", "circle-stroke-width": 1 } },
            { id: "lrt2-stops", type: "circle", filter: ["==", ["get", "type"], "LRT2-Stop"], paint: { "circle-radius": 5, "circle-color": modeColors.LRT2, "circle-stroke-color": "#fff", "circle-stroke-width": 1 } },
            { id: "bus-stops", type: "circle", filter: ["==", ["get", "type"], "Bus-Stop"], paint: { "circle-radius": 5, "circle-color": modeColors.Bus, "circle-stroke-color": "#fff", "circle-stroke-width": 1 } },
            { id: "p2p-bus-stops", type: "circle", source: "transit-route", filter: ["==", ["get", "type"], "P2P-Bus-Stop"], paint: { "circle-radius": 5, "circle-color": modeColors['P2P-Bus'], "circle-stroke-color": "#fff", "circle-stroke-width": 1 } },
        ];

        // Add each layer
        layers.forEach(layer => {
            const layoutProps = layer.type === 'line' ? { "line-join": "round", "line-cap": "round" } : {};
            safeAddLayer({ ...layer, source: "transit-route", layout: layoutProps });
        });
        console.log("Transit layers added/verified.");
  };

  // --- Distance Calculation ---
  const calculateDistance = (point1, point2) => {
    if (!point1 || typeof point1.lat !== 'number' || typeof point1.lng !== 'number' ||
        !point2 || typeof point2.lat !== 'number' || typeof point2.lng !== 'number') {
         return Infinity;
    }
    const R = 6371; const dLat = ((point2.lat - point1.lat) * Math.PI) / 180;
    const dLon = ((point2.lng - point1.lng) * Math.PI) / 180;
    const lat1Rad = (point1.lat * Math.PI) / 180; const lat2Rad = (point2.lat * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1Rad) * Math.cos(lat2Rad);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };
  // const calculateNearestVertexDistance = (coordinates, center) => { /* ... removed ... */ };
  // const calculatePointToLineDistance = useCallback((coordinates, center) => { /* ... as before ... */ }, []); // Already defined above


  // --- Event Handlers ---

  // Handles clicking on a route in the sidebar
  const handleRouteSelection = (route) => {
    if (!mapRef.current || !route?.geometry) return;

    if (selectedRoute === route) {
      setSelectedRoute(null);
      mapRef.current.flyTo({ center: [markerCenter.lng, markerCenter.lat], zoom: INITIAL_MAP_ZOOM });
    } else {
      setSelectedRoute(route);
      try {
          if (route.geometry.type !== 'LineString' || !Array.isArray(route.geometry.coordinates) || route.geometry.coordinates.length < 2) { throw new Error("Invalid LineString"); }
          const bounds = turf.bbox(route.geometry);
          if (Array.isArray(bounds) && bounds.length === 4 && bounds.every(n => typeof n === 'number' && !isNaN(n))) {
              mapRef.current.fitBounds(bounds, { padding: { top: 40, bottom: 40, left: 340, right: 40 }, maxZoom: 15, duration: 1000 });
          } else {
              console.warn("Invalid bounds:", bounds);
              const coordinates = route.geometry.coordinates;
              const routeCenter = coordinates[Math.floor(coordinates.length / 2)];
              if (Array.isArray(routeCenter) && routeCenter.length >= 2) { mapRef.current.flyTo({ center: [routeCenter[0], routeCenter[1]], zoom: 12, essential: true }); }
          }
      } catch (e) {
          console.error("Error fitting bounds:", e);
           const coordinates = route.geometry.coordinates;
           if (Array.isArray(coordinates) && coordinates.length > 0) {
               const routeCenter = coordinates[Math.floor(coordinates.length / 2)];
               if (Array.isArray(routeCenter) && routeCenter.length >= 2) { mapRef.current.flyTo({ center: [routeCenter[0], routeCenter[1]], zoom: 12, essential: true }); }
           }
      }
    }
  };

  // Resets the selected route AND map view
  const handleResetSelection = () => {
    setSelectedRoute(null);
    if(mapRef.current) {
        mapRef.current.flyTo({
            center: [INITIAL_MAP_CENTER.lng, INITIAL_MAP_CENTER.lat],
            zoom: INITIAL_MAP_ZOOM,
            duration: 1000
        });
    }
  };

  // Handles checkbox changes for vehicle filters
  const handleFilterChange = (type) => {
    setVehicleFilters(prevFilters => ({
      ...prevFilters,
      [type]: !prevFilters[type],
    }));
    setSelectedRoute(null); // Deselect route on filter change
  };

  // Gets color based on route type
  const getRouteColor = (type) => {
    return modeColors[type?.replace('-Stop', '')] || "#ccc";
  };

  // --- JSX Return ---
  return (
    <div style={{ position: "relative", height: "100vh", fontFamily: "Montserrat, sans-serif" }}>
      {/* Sidebar */}
      <div style={{
          position: "absolute", top: 0, left: 0, height: "100%", width: "300px",
          backgroundColor: "rgba(0, 0, 0, 0.8)", color: "white",
          zIndex: 10, display: 'flex', flexDirection: 'column', boxShadow: '2px 0 5px rgba(0,0,0,0.3)'
      }}>
          {/* Top Section (Non-scrolling) */}
          <div style={{padding: "16px", flexShrink: 0}}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                  <img src={logo} alt="Logo" style={{ width: "40px", height: "40px", cursor: "pointer" }} onClick={() => navigate("/")}/>
                  <button onClick={() => navigate("/nav-view")} style={{ padding: "8px 14px", backgroundColor: "#1e40af", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: '0.9rem' }}>
                      Nav View
                  </button>
              </div>
              <h3 style={{ marginBottom: "8px", fontSize: "1.0rem", fontWeight: "600" }}>Filter by Vehicle Type</h3>
              {/* Filter Checkboxes */}
              <div style={{
                  display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0px 8px",
                  marginBottom: "10px", fontSize: '0.9rem'
              }}>
                  {Object.keys(vehicleFilters).map((type) => (
                      <label key={type} style={{ marginBottom: "2px", cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          <input type="checkbox" checked={vehicleFilters[type]} onChange={() => handleFilterChange(type)} style={{ marginRight: "8px", cursor: 'pointer', verticalAlign: 'middle' }}/>
                          <span style={{verticalAlign: 'middle'}}>{type}</span>
                      </label>
                  ))}
              </div>
              <h2 style={{ marginTop: "16px", marginBottom: "10px", fontSize: "1.15rem", fontWeight: "600" }}>Nearest Routes</h2>
          </div>

          {/* Scrollable List */}
          <div style={{flexGrow: 1, overflowY: 'auto', padding: '0 16px' }}>
              <ul style={{ paddingLeft: "0", listStyle: "none", margin: 0 }}>
                  {nearestRoutes.length > 0 ? nearestRoutes.map((route, index) => {
                       const routeName = route?.properties?.name || `Route ${index + 1}`;
                       const routeType = route?.properties?.type || '';
                       return (
                           <li
                               key={routeName + index}
                               onClick={() => handleRouteSelection(route)}
                               style={{
                                   cursor: "pointer", marginBottom: "8px",
                                   backgroundColor: getRouteColor(routeType),
                                   color: "#111",
                                   padding: "10px 14px", borderRadius: "8px", fontWeight: "600",
                                   border: selectedRoute === route ? "3px solid #fff" : "3px solid transparent",
                                   transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
                                   boxShadow: selectedRoute === route ? '0 0 8px rgba(255, 255, 255, 0.7)' : 'none'
                               }}
                           >
                               <div style={{ fontSize: "0.95rem", marginBottom: '3px' }}>{routeName}</div>
                               <div style={{ fontSize: "0.8rem", fontWeight: "400", display: "flex", alignItems: "center", gap: "10px", marginTop: "4px", color: '#333' }}>
                                   <span>{formatDistance(route.distance)}</span>
                                   <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                       <span className="material-icons" style={{ fontSize: "16px" }}>directions_walk</span>
                                       {formatWalkingTime(route.distance)}
                                   </span>
                               </div>
                           </li>
                       );
                   }) : <li style={{color: '#aaa', padding: '10px 0'}}>No routes found nearby or matching filters.</li>}
              </ul>
          </div>

          {/* Bottom Button */}
          <div style={{padding: "16px", flexShrink: 0}}>
              <button onClick={handleResetSelection} disabled={!selectedRoute} style={{
                  padding: "10px 16px", width: '100%',
                  backgroundColor: selectedRoute ? "#dc2626" : '#6b7280',
                  color: "white", border: "none", borderRadius: "6px", cursor: selectedRoute ? "pointer" : 'not-allowed',
                  fontWeight: "bold", fontFamily: "Montserrat", opacity: selectedRoute ? 1 : 0.6, fontSize: '0.9rem'
              }}>
                  Reset Selection
              </button>
          </div>
      </div>

      {/* Legend */}
      <div style={{
          position: "absolute", top: "16px", right: "16px", backgroundColor: "rgba(0, 0, 0, 0.8)",
          color: "white", padding: "10px 12px", borderRadius: "6px", zIndex: 10, boxShadow: "0 2px 4px rgba(0, 0, 0, 0.4)", fontSize: '0.8rem'
      }}>
          <h4 style={{ marginBottom: "8px", fontWeight: "bold", textAlign: "center", marginTop: 0, fontSize: '0.9rem' }}>Legend</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {Object.entries(modeColors)
                  .filter(([mode]) => mode !== 'Walk' && mode !== 'Driving' && !mode.includes('-Stop'))
                  .map(([mode, color]) => (
                      <div key={mode} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div style={{ width: "14px", height: "14px", borderRadius: "50%", backgroundColor: color, flexShrink: 0 }} />
                          <span>{mode}</span>
                      </div>
                  ))}
          </div>
      </div>

      {/* Map container */}
      <div ref={mapContainerRef} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", zIndex: 1 }} />

      {/* Marker overlay */}
      <div style={{
          position: "absolute", top: "50%", left: "calc(50% + 150px)",
          width: "24px", height: "24px", backgroundColor: "rgba(255, 0, 0, 0.8)",
          border: '2px solid white', borderRadius: "50% 50% 50% 0",
          transform: "translate(-50%, -100%) rotate(-45deg)",
          transformOrigin: "center bottom",
          zIndex: 20, boxShadow: "0 0 8px rgba(0,0,0,0.6)",
          pointerEvents: 'none'
      }}/>
    </div>
  );
};

export default MapView;
