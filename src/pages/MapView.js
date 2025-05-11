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
    Jeep: "#FFA500", // Orange
    "P2P-Bus": "#f97316", // Orange-500
    Bus: "#3b82f6", // Blue-500
    // Colors for stops if needed, can be same as line
    "MRT-Stop": "#facc15",
    "LRT1-Stop": "#22c55e",
    "LRT2-Stop": "#7A07D1",
    "Bus-Stop": "#3b82f6",
    "P2P-Bus-Stop": "#f97316",
};

// Define initial map center state
const INITIAL_MAP_CENTER = { lng: 121.05, lat: 14.55 }; // Centered more on Metro Manila
const INITIAL_MAP_ZOOM = 11;
// Define proximity threshold for showing stops along a selected line
const MAX_STOP_DISTANCE_TO_LINE_KM = 0.001; 

const MapView = () => {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [nearestRoutes, setNearestRoutes] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [markerCenter, setMarkerCenter] = useState(INITIAL_MAP_CENTER);
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [showFilters, setShowFilters] = useState(!isMobile);
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [vehicleFilters, setVehicleFilters] = useState({
    MRT: true, LRT1: true, LRT2: true, Jeep: true, "P2P-Bus": true, Bus: true,
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
    const iconsLink = document.getElementById('material-icons-link');
    if (!iconsLink) {
         const link = document.createElement('link'); link.id = 'material-icons-link';
         link.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
         link.rel = 'stylesheet'; document.head.appendChild(link);
         return () => { const el = document.getElementById('material-icons-link'); if (el) el.remove(); };
    }
  }, []);
  useEffect(() => {
    const montserratLink = document.getElementById('montserrat-link');
     if (!montserratLink) {
        const montserrat = document.createElement('link'); montserrat.id = 'montserrat-link';
        montserrat.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600&display=swap';
        montserrat.rel = 'stylesheet'; document.head.appendChild(montserrat);
        return () => { const el = document.getElementById('montserrat-link'); if (el) el.remove(); };
     }
  }, []);

  // --- Memoized Map Update Helpers ---
  const calculateShiftedCenter = useCallback((mapCenter) => {
  if (!mapRef.current) return null;
  try {
    const mapContainer = mapRef.current.getContainer();
    const centerScreenPoint = mapRef.current.project(mapCenter);

    const isMobileView = window.innerWidth <= 768;

    if (isMobileView) {
      // Mobile layout: center horizontally, 30vh from top
      centerScreenPoint.x = mapContainer.clientWidth / 2;
      centerScreenPoint.y = mapContainer.clientHeight * 0.3;
    } else {
      // Desktop layout: center vertically, 150px right of center
      centerScreenPoint.x += 150;
    }

    return mapRef.current.unproject(centerScreenPoint);
  } catch (e) {
    console.error("Error calculating shifted center:", e);
    return null;
  }
}, []);

  const calculatePointToLineDistance = useCallback((coordinates, center) => {
    if (!Array.isArray(coordinates) || coordinates.length < 2 || !center) return Infinity;
    let minDistanceSq = Infinity; const cx = center.lng; const cy = center.lat;
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
    const degreesPerKmLat = 1 / 111.32; const degreesPerKmLon = 1 / (111.32 * Math.cos(center.lat * Math.PI / 180));
    const avgDegreesPerKm = (degreesPerKmLat + degreesPerKmLon) / 2;
    return avgDegreesPerKm > 0 ? Math.sqrt(minDistanceSq) / avgDegreesPerKm : Infinity;
  }, []);

  const updateNearestRoutes = useCallback((center) => {
    if (!center || typeof center.lng !== 'number' || typeof center.lat !== 'number') { return; }
    // console.log(`Updating nearest routes for center: ${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`);
    const filteredFeatures = transitRoute.features.filter(feature => {
      const type = feature?.properties?.type; const mode = type?.replace('-Stop', '');
      return type && mode && vehicleFilters[mode] === true && !type.includes('-Stop') &&
             feature?.geometry?.type === 'LineString' &&
             feature?.geometry?.coordinates && Array.isArray(feature.geometry.coordinates);
    });
    const distances = filteredFeatures.map((feature) => {
      let distance = Infinity;
      try { distance = calculatePointToLineDistance(feature.geometry.coordinates, center); }
      catch(e) { console.error(`Error calculating distance for ${feature?.properties?.name}:`, e); distance = Infinity; }
      return { ...feature, distance: (typeof distance === 'number' && !isNaN(distance)) ? distance : Infinity };
    });
    const validDistances = distances.filter(route => route.distance !== Infinity);
    const sortedRoutes = validDistances.sort((a, b) => a.distance - b.distance);
    setNearestRoutes(sortedRoutes.slice(0, 7));
    // console.log(`Found ${sortedRoutes.slice(0, 7).length} nearest routes after sorting.`);
  }, [vehicleFilters, calculatePointToLineDistance]);

  const handleMapMoveEnd = useCallback(() => {
      if (!mapRef.current) return;
      const mapCenter = mapRef.current.getCenter();
      const shiftedCenter = calculateShiftedCenter(mapCenter);
      if (shiftedCenter) {
          setMarkerCenter({ lng: shiftedCenter.lng, lat: shiftedCenter.lat });
          updateNearestRoutes(shiftedCenter);
      }
  }, [calculateShiftedCenter, updateNearestRoutes]);

  const addAllLayers = useCallback((map) => {
        const safeAddLayer = (layerConfig) => {
            if (!map.getLayer(layerConfig.id)) {
                try { map.addLayer(layerConfig); }
                catch (e) { console.error(`Failed to add layer '${layerConfig.id}':`, e); }
            }
        };
        const layers = [
            { id: "mrt-line", type: "line", filter: ["==", ["get", "type"], "MRT"], paint: { "line-color": modeColors.MRT, "line-width": 4 } },
            { id: "lrt1-line", type: "line", filter: ["==", ["get", "type"], "LRT1"], paint: { "line-color": modeColors.LRT1, "line-width": 4 } },
            { id: "lrt2-line", type: "line", filter: ["==", ["get", "type"], "LRT2"], paint: { "line-color": modeColors.LRT2, "line-width": 4 } },
            { id: "jeep-lines", type: "line", filter: ["==", ["get", "type"], "Jeep"], paint: { "line-color": modeColors.Jeep, "line-width": 3, 'line-opacity': 0.7 } },
            { id: "p2p-bus-lines", type: "line", filter: ["==", ["get", "type"], "P2P-Bus"], paint: { "line-color": modeColors['P2P-Bus'], "line-width": 3 } },
            { id: "bus-lines", type: "line", filter: ["==", ["get", "type"], "Bus"], paint: { "line-color": modeColors.Bus, "line-width": 3 } },
            { id: "mrt-stops", type: "circle", filter: ["==", ["get", "type"], "MRT-Stop"], paint: { "circle-radius": 5, "circle-color": modeColors["MRT-Stop"], "circle-stroke-color": "#fff", "circle-stroke-width": 1 } },
            { id: "lrt1-stops", type: "circle", filter: ["==", ["get", "type"], "LRT1-Stop"], paint: { "circle-radius": 5, "circle-color": modeColors["LRT1-Stop"], "circle-stroke-color": "#fff", "circle-stroke-width": 1 } },
            { id: "lrt2-stops", type: "circle", filter: ["==", ["get", "type"], "LRT2-Stop"], paint: { "circle-radius": 5, "circle-color": modeColors["LRT2-Stop"], "circle-stroke-color": "#fff", "circle-stroke-width": 1 } },
            { id: "bus-stops", type: "circle", filter: ["==", ["get", "type"], "Bus-Stop"], paint: { "circle-radius": 5, "circle-color": modeColors["Bus-Stop"], "circle-stroke-color": "#fff", "circle-stroke-width": 1 } },
            { id: "p2p-bus-stops", type: "circle", filter: ["==", ["get", "type"], "P2P-Bus-Stop"], paint: { "circle-radius": 5, "circle-color": modeColors['P2P-Bus-Stop'], "circle-stroke-color": "#fff", "circle-stroke-width": 1 } },
        ];
        layers.forEach(layer => {
            const layoutProps = layer.type === 'line' ? { "line-join": "round", "line-cap": "round" } : {};
            safeAddLayer({ ...layer, source: "transit-route", layout: layoutProps });
        });
        console.log("Transit layers added/verified.");
  }, []); // modeColors is constant

  const updateMapDataSource = useCallback(() => {
    if (!mapRef.current || !mapRef.current.getSource("transit-route")) return;
    let featuresToShow = [];
    if (selectedRoute) {
       if (selectedRoute.type === 'Feature' && selectedRoute.geometry?.type === 'LineString') {
           featuresToShow.push(selectedRoute);
           const selectedMode = selectedRoute.properties?.type;
           if (selectedMode && !selectedMode.includes('-Stop')) {
               let stopTypesToFind = [`${selectedMode}-Stop`];
               if (selectedMode === 'Bus' || selectedMode === 'P2P-Bus') {
                   if (!stopTypesToFind.includes('Bus-Stop')) stopTypesToFind.push('Bus-Stop');
                   if (!stopTypesToFind.includes('P2P-Bus-Stop')) stopTypesToFind.push('P2P-Bus-Stop');
               }
               const relatedStops = transitRoute.features.filter(feature => {
                   const isCorrectStopType = feature?.geometry?.type === 'Point' && feature?.properties?.type && stopTypesToFind.includes(feature.properties.type);
                   if (!isCorrectStopType) return false;
                   try {
                       if (!Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length < 2) return false;
                       const stopPoint = turf.point(feature.geometry.coordinates);
                       const distanceToLine = calculatePointToLineDistance(selectedRoute.geometry.coordinates, {lng: stopPoint.geometry.coordinates[0], lat: stopPoint.geometry.coordinates[1]});
                       return distanceToLine <= MAX_STOP_DISTANCE_TO_LINE_KM;
                   } catch (e) { console.error(`Error checking distance for stop ${feature?.properties?.name}:`, e); return false; }
               });
               featuresToShow.push(...relatedStops);
           }
       } else { console.warn("Selected route is not a valid GeoJSON LineString Feature:", selectedRoute); }
    } else {
      featuresToShow = transitRoute.features.filter(feature => {
        const type = feature?.properties?.type; const mode = type?.replace('-Stop', '');
        return type && mode && vehicleFilters[mode] && feature?.geometry;
      });
    }
    const newGeoJSON = { type: "FeatureCollection", features: featuresToShow };
    try { mapRef.current.getSource("transit-route")?.setData(newGeoJSON); }
    catch(e) { console.error("Error setting map source data:", e); }
  }, [selectedRoute, vehicleFilters, calculatePointToLineDistance]);

  const updateLayerVisibility = useCallback(() => {
      if (!mapRef.current) return;
      const stopLayers = ["mrt-stops", "lrt1-stops", "lrt2-stops", "bus-stops", "p2p-bus-stops"];
      const lineLayers = ["mrt-line", "lrt1-line", "lrt2-line", "bus-lines", "p2p-bus-lines", "jeep-lines"];
      const safeSetLayoutProperty = (layerId, prop, value) => {
          if (mapRef.current?.getLayer(layerId)) {
              try { mapRef.current.setLayoutProperty(layerId, prop, value); } catch (e) { /* ignore */ }
          }
      };
      if (selectedRoute) {
          const selectedMode = selectedRoute.properties?.type;
          const isBusOrP2P = selectedMode === 'Bus' || selectedMode === 'P2P-Bus';
          lineLayers.forEach(layerId => safeSetLayoutProperty(layerId, "visibility", "none"));
          const selectedLineLayerId = lineLayers.find(id => id.startsWith(selectedMode?.toLowerCase()));
          if (selectedLineLayerId) { safeSetLayoutProperty(selectedLineLayerId, "visibility", "visible"); }
          stopLayers.forEach(layerId => {
              let showLayer = false;
              let layerMode = layerId.split('-')[0];
              if (layerMode === 'lrt') layerMode += layerId.split('-')[1]; // Handle lrt1, lrt2
              if (layerMode === 'p2p') layerMode = 'P2P-Bus';
              layerMode = layerMode.toUpperCase();
              // const layerStopType = `${layerMode}-Stop`; // This logic wasn't quite right

              // Show stops if their layer type matches the selected mode's stop type
              if (isBusOrP2P && (layerId === 'bus-stops' || layerId === 'p2p-bus-stops')) { showLayer = true; }
              else if (layerId.startsWith(selectedMode?.toLowerCase())) { showLayer = true; }

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
  }, [selectedRoute, vehicleFilters]);


  // --- Map Initialization ---
  useEffect(() => {
    if (!mapContainerRef.current) return;
    let isMounted = true;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: `https://maps.geo.${awsConfig.region}.amazonaws.com/maps/v0/maps/${awsConfig.mapName}/style-descriptor?key=${awsConfig.apiKey}`,
      center: [INITIAL_MAP_CENTER.lng, INITIAL_MAP_CENTER.lat],
      zoom: INITIAL_MAP_ZOOM,
    });
    mapRef.current = map;

    map.on("load", () => {
        if (!mapRef.current || !isMounted) return;
        console.log("Map loaded event fired.");
        if (!mapRef.current.getSource("transit-route")) {
            mapRef.current.addSource("transit-route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        }
        addAllLayers(map); // Add layers using the memoized function
        updateMapDataSource(); // Initial data load
        const initialCenter = map.getCenter();
        const initialShiftedCenter = calculateShiftedCenter(initialCenter);
        if (initialShiftedCenter && isMounted) {
            setMarkerCenter({ lng: initialShiftedCenter.lng, lat: initialShiftedCenter.lat });
            updateNearestRoutes(initialShiftedCenter); // Initial nearest routes calculation
        }
        // Event listener is managed by a separate effect now
    });
     map.on('error', (e) => console.error("MapLibre Error:", e));
    return () => {
      isMounted = false;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Runs once on mount

  // Effect to manage map event listeners
  useEffect(() => {
      if (mapRef.current && mapRef.current.isStyleLoaded()) {
          const currentMap = mapRef.current;
          // Use the memoized handler
          currentMap.on('moveend', handleMapMoveEnd);
          // console.log("Map 'moveend' listener attached/updated.");
          // Cleanup function
          return () => {
              // Check if map still exists and style loaded before removing listener
              if (currentMap.isStyleLoaded()) {
                  try { currentMap.off('moveend', handleMapMoveEnd); } catch (e) {/*ignore*/}
                  // console.log("Map 'moveend' listener detached.");
              }
          };
      }
  }, [handleMapMoveEnd]); // Re-attach only if the memoized handler changes

  // --- Effect to Update Map Data/Visibility AND Nearest Routes When Filters/Selection Change ---
  useEffect(() => {
    if (!mapRef.current || !mapRef.current.isStyleLoaded()) return;
    // console.log("Updating map data source, layer visibility, and nearest routes due to selection/filter change.");
    updateMapDataSource();
    updateLayerVisibility();
    // *** Recalculate nearest routes when filters change ***
    if (!selectedRoute) {
        // console.log("Filters changed, recalculating nearest routes with current markerCenter.");
        updateNearestRoutes(markerCenter); // Use current markerCenter
    }
  }, [selectedRoute, vehicleFilters, markerCenter, updateMapDataSource, updateLayerVisibility, updateNearestRoutes]);


  // --- Distance Calculation (only one needed now) ---
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


  // --- Event Handlers ---
  const handleRouteSelection = (route) => {
  if (!mapRef.current || !route?.geometry) return;

  if (selectedRoute === route) {
    setSelectedRoute(null);
    mapRef.current.flyTo({
      center: [markerCenter.lng, markerCenter.lat],
      zoom: INITIAL_MAP_ZOOM
    });
  } else {
    setSelectedRoute(route);

    try {
      const geometry = route.geometry;
      if (geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) {
        throw new Error("Invalid LineString");
      }

      const bounds = turf.bbox(geometry);
      if (Array.isArray(bounds) && bounds.length === 4 && bounds.every(n => typeof n === 'number' && !isNaN(n))) {
        mapRef.current.fitBounds(bounds, {
          padding: isMobile
            ? { top: 100, bottom: 200, left: 30, right: 30 } // more top padding for 60vh space
            : { top: 40, bottom: 40, left: 340, right: 40 },
          maxZoom: 15,
          duration: 1000,
        });
      } else {
        console.warn("Invalid bounds:", bounds);
        const coordinates = geometry.coordinates;
        const routeCenter = coordinates[Math.floor(coordinates.length / 2)];
        if (Array.isArray(routeCenter) && routeCenter.length >= 2) {
          mapRef.current.flyTo({
            center: [routeCenter[0], routeCenter[1]],
            zoom: isMobile ? 13.5 : 12,
            essential: true
          });
        }
      }
    } catch (e) {
      console.error("Error fitting bounds:", e);
      const coordinates = route.geometry.coordinates;
      if (Array.isArray(coordinates) && coordinates.length > 0) {
        const routeCenter = coordinates[Math.floor(coordinates.length / 2)];
        if (Array.isArray(routeCenter) && routeCenter.length >= 2) {
          mapRef.current.flyTo({
            center: [routeCenter[0], routeCenter[1]],
            zoom: isMobile ? 13.5 : 12,
            essential: true
          });
        }
      }
    }
  }
};

const handleResetSelection = () => {
  setSelectedRoute(null);
  if (mapRef.current) {
    mapRef.current.flyTo({
      center: [INITIAL_MAP_CENTER.lng, INITIAL_MAP_CENTER.lat],
      zoom: INITIAL_MAP_ZOOM,
      duration: 1000,
    });
    setMarkerCenter(INITIAL_MAP_CENTER);
    updateNearestRoutes(INITIAL_MAP_CENTER);
  }
};

  // Handles checkbox changes for vehicle filters
  const handleFilterChange = (type) => {
    setVehicleFilters(prevFilters => ({
      ...prevFilters,
      [type]: !prevFilters[type],
    }));
    setSelectedRoute(null); // Deselect route on filter change
    // Nearest routes will update via the useEffect hook watching vehicleFilters
  };

  // Gets color based on route type
  const getRouteColor = (type) => {
    return modeColors[type?.replace('-Stop', '')] || "#ccc";
  };

  // --- JSX Return ---
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  
  return (
  <div style={{ position: "relative", height: "100vh", fontFamily: "Montserrat, sans-serif" }}>
    
    {/* Sidebar */}
    <div style={{
      position: "absolute",
      bottom: isMobile ? 0 : undefined,
      left: isMobile ? 0 : 0,
      top: isMobile ? undefined : 0,
      height: isMobile ? "40vh" : "100%",
      width: isMobile ? "100%" : "300px",
      backgroundColor: "rgba(0, 0, 0, 0.8)",
      color: "white",
      zIndex: 10,
      display: 'flex',
      flexDirection: 'column',
      boxShadow: isMobile ? '0 -2px 5px rgba(0,0,0,0.3)' : '2px 0 5px rgba(0,0,0,0.3)'
    }}>
      
      {/* Top Section */}
      <div style={{ padding: isMobile ? "8px 12px" : "16px", flexShrink: 0 }}>
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: isMobile ? "8px" : "16px"
        }}>
          <img
            src={logo}
            alt="Logo"
            style={{ width: "40px", height: "40px", cursor: "pointer" }}
            onClick={() => navigate("/")}
          />
          <button onClick={() => navigate("/nav-view")} style={{
            padding: isMobile ? "6px 10px" : "8px 14px",
            backgroundColor: "#1e40af",
            color: "#fff",
            border: "none",
            borderRadius: "5px",
            cursor: "pointer",
            fontSize: '0.85rem'
          }}>
            Nav View
          </button>
        </div>

        {(!isMobile || showFilters) && (
          <>
            <h3 style={{
              marginBottom: "8px",
              fontSize: "0.95rem",
              fontWeight: "600"
            }}>
              Filter by Vehicle Type
            </h3>
            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr 1fr 1fr" : "1fr 1fr",
              gap: "4px 8px",
              marginBottom: isMobile ? "6px" : "10px",
              fontSize: '0.85rem'
            }}>
              {Object.keys(vehicleFilters).map((type) => (
                <label
                  key={type}
                  style={{ marginBottom: "2px", cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  <input
                    type="checkbox"
                    checked={vehicleFilters[type]}
                    onChange={() => handleFilterChange(type)}
                    style={{
                      marginRight: "6px",
                      cursor: 'pointer',
                      verticalAlign: 'middle'
                    }}
                  />
                  <span style={{ verticalAlign: 'middle' }}>{type}</span>
                </label>
              ))}
            </div>
          </>
        )}

        <h2 style={{
          marginTop: isMobile ? "8px" : "16px",
          marginBottom: isMobile ? "6px" : "10px",
          fontSize: "1.05rem",
          fontWeight: "600"
        }}>
          Nearest Routes
        </h2>
      </div>

      {/* Scrollable Routes List */}
      <div style={{
        flexGrow: 1,
        overflowY: 'auto',
        padding: isMobile ? '0 12px' : '0 16px'
      }}>
        <ul style={{ paddingLeft: "0", listStyle: "none", margin: 0 }}>
          {nearestRoutes.length > 0 ? nearestRoutes.map((route, index) => {
            const routeName = route?.properties?.name || `Route ${index + 1}`;
            const routeType = route?.properties?.type || '';
            return (
              <li
                key={routeName + index}
                onClick={() => handleRouteSelection(route)}
                style={{
                  cursor: "pointer",
                  marginBottom: "6px",
                  backgroundColor: getRouteColor(routeType),
                  color: "#111",
                  padding: "10px 12px",
                  borderRadius: "5px",
                  fontWeight: "600",
                  border: selectedRoute === route ? "3px solid #fff" : "3px solid transparent",
                  transition: 'all 0.2s ease',
                  boxShadow: selectedRoute === route ? '0 0 8px rgba(255, 255, 255, 0.7)' : 'none'
                }}
              >
                <div style={{ fontSize: "0.95rem", marginBottom: '2px' }}>{routeName}</div>
                <div style={{
                  fontSize: "0.9rem",
                  fontWeight: "600",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  color: '#333'
                }}>
                  <span>{formatDistance(route.distance)}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <span className="material-icons" style={{ fontSize: "16px" }}>directions_walk</span>
                    {formatWalkingTime(route.distance)}
                  </span>
                </div>
              </li>
            );
          }) : (
            <li style={{ color: '#aaa', padding: '10px 0' }}>
              No routes found nearby or matching filters.
            </li>
          )}
        </ul>
      </div>

      {/* Bottom Reset + Filter Toggle Buttons */}
      <div style={{
        padding: isMobile ? "8px 12px" : "16px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexShrink: 0
      }}>
        <button
          onClick={handleResetSelection}
          disabled={!selectedRoute}
          style={{
            flex: 1,
            padding: "10px 12px",
            backgroundColor: selectedRoute ? "#dc2626" : "#6b7280",
            color: "white",
            border: "none",
            borderRadius: "5px",
            cursor: selectedRoute ? "pointer" : "not-allowed",
            fontWeight: "bold",
            fontFamily: "Montserrat",
            fontSize: "0.9rem",
            opacity: selectedRoute ? 1 : 0.6
          }}
        >
          Reset Selection
        </button>

        {isMobile && (
          <button
            onClick={() => setShowFilters(prev => !prev)}
            style={{
              padding: "10px 12px",
              backgroundColor: "#374151",
              color: "#fff",
              border: "none",
              borderRadius: "5px",
              cursor: "pointer",
              fontSize: "0.85rem",
              fontFamily: "Montserrat",
              whiteSpace: "nowrap"
            }}
          >
            {showFilters ? "Hide Filter" : "Show Filter"}
          </button>
        )}
      </div>
    </div>

    {/* Marker */}
    <div style={{
      position: "absolute",
      top: isMobile ? "30vh" : "50%",
      left: isMobile ? "50%" : "calc(50% + 150px)",
      width: "24px",
      height: "24px",
      backgroundColor: "rgba(255, 0, 0, 0.8)",
      border: "2px solid white",
      borderRadius: "50% 50% 50% 0",
      transform: "translate(-50%, -100%) rotate(-45deg)",
      transformOrigin: "center bottom",
      zIndex: 20,
      boxShadow: "0 0 8px rgba(0,0,0,0.6)",
      pointerEvents: "none"
    }}/>

    {/* Legend */}
    <div style={{
      position: "absolute",
      top: "-5px",
      right: isMobile? "16px":"50px",
      backgroundColor: "rgba(0, 0, 0, 0.8)",
      color: "white",
      padding: "10px 12px",
      borderRadius: "5px",
      zIndex: 10,
      boxShadow: "0 2px 4px rgba(0, 0, 0, 0.4)",
      fontSize: '0.8rem'
    }}>
      <h4 style={{ marginBottom: "8px", fontWeight: "bold", textAlign: "center", marginTop: 0, fontSize: '0.9rem' }}>Legend</h4>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {Object.entries(modeColors)
          .filter(([mode]) => mode !== 'Walk' && mode !== 'Driving' && !mode.includes('-Stop'))
          .map(([mode, color]) => (
            <div key={mode} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{
                width: "14px", height: "14px", borderRadius: "50%",
                backgroundColor: color, flexShrink: 0
              }} />
              <span>{mode}</span>
            </div>
          ))}
      </div>
    </div>

    {/* Map container */}
    <div ref={mapContainerRef} style={{
      position: "absolute",
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
      zIndex: 1
    }}/>
  </div>
  );
};

export default MapView;
