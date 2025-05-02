import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useNavigate } from "react-router-dom";
import transitRoute from "../data/transit-lines.json"; // Ensure path is correct
import { awsConfig } from "../config/config"; // Ensure path is correct
import logo from "../assets/logo.png"; // Ensure path is correct
import * as turf from "@turf/turf"; // Import turf for bounding box

// *** ADD modeColors DEFINITION HERE ***
const modeColors = {
    MRT: "#facc15", // Yellow-400
    LRT: "#22c55e", // Green-500
    Jeep: "#FFA500", // Orange
    "P2P-Bus": "#f97316", // Orange-500
    Bus: "#3b82f6", // Blue-500
    Walk: "#9ca3af", // Gray-400 (Used in RouteBreakdown, might not be needed here)
    Driving: "#6b7280", // Gray-500 (Used in RouteBreakdown)
    // Add other potential modes if needed
};
// *************************************

const MapView = () => {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [nearestRoutes, setNearestRoutes] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [markerCenter, setMarkerCenter] = useState({ lng: 121.0357, lat: 14.4981 });
  const navigate = useNavigate();
  const [vehicleFilters, setVehicleFilters] = useState({
    MRT: true,
    LRT: true,
    Jeep: true,
    "P2P-Bus": true,
    Bus: true,
  });

  // --- Helper Functions ---
  const formatDistance = (km) => {
    // Add safety check for non-numeric input
    if (typeof km !== 'number' || isNaN(km)) return 'N/A';
    return km < 1 ? `${(km * 1000).toFixed(0)} m` : `${km.toFixed(2)} km`;
  };

  const formatWalkingTime = (km) => {
     // Add safety check
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
         // Return cleanup function only if link was added by this effect
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

  // --- Map Initialization and Nearest Routes Effect ---
  useEffect(() => {
    if (!mapContainerRef.current) return;

    let isMounted = true; // Flag to prevent state updates on unmounted component

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: `https://maps.geo.${awsConfig.region}.amazonaws.com/maps/v0/maps/${awsConfig.mapName}/style-descriptor?key=${awsConfig.apiKey}`,
      center: [markerCenter.lng, markerCenter.lat],
      zoom: 11,
    });

    mapRef.current = map;

    map.on("load", () => {
        if (!mapRef.current || !isMounted) return; // Check map still exists and component is mounted
        // Add source for transit data
        if (!mapRef.current.getSource("transit-route")) {
            mapRef.current.addSource("transit-route", {
                type: "geojson",
                data: { type: "FeatureCollection", features: [] } // Initialize empty
            });
        }

        // Add all layers (ensure this function exists and adds layers correctly)
        addAllLayers(map);

        // Update source data based on filters
        updateMapDataSource();

        // Event listener for map movement
        map.on("moveend", handleMapMoveEnd);

        // Initial calculation for nearest routes
        const initialCenter = map.getCenter();
        const initialShiftedCenter = calculateShiftedCenter(initialCenter);
        if (initialShiftedCenter) {
            // Check mount status before setting state
            if (isMounted) {
                setMarkerCenter({ lng: initialShiftedCenter.lng, lat: initialShiftedCenter.lat });
                updateNearestRoutes(initialShiftedCenter);
            }
        }
    });

     map.on('error', (e) => console.error("MapLibre Error:", e));

    // Cleanup function
    return () => {
      isMounted = false; // Set flag on unmount
      if (mapRef.current) {
        // Check if map still exists before removing listener
        if (mapRef.current.getStyle()) { // Check if map is still valid
             mapRef.current.off("moveend", handleMapMoveEnd);
        }
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleFilters]); // Dependencies kept as is, but added eslint disable comment if needed

  // --- Effect to Update Map Data/Visibility When Filters/Selection Change ---
  useEffect(() => {
    if (!mapRef.current || !mapRef.current.isStyleLoaded()) return;

    updateMapDataSource(); // Update data based on selection and filters
    updateLayerVisibility(); // Update visibility based on filters

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoute, vehicleFilters]); // Dependencies kept as is

  // --- Helper Functions for Map Updates ---

  // Calculates the shifted center point based on sidebar offset
  const calculateShiftedCenter = (mapCenter) => {
      if (!mapRef.current) return null;
      try {
        const centerScreenPoint = mapRef.current.project(mapCenter);
        centerScreenPoint.x += 150; // Shift right by approx half sidebar width
        return mapRef.current.unproject(centerScreenPoint);
      } catch (e) {
        console.error("Error calculating shifted center:", e);
        return null;
      }
  }

  // Handles map move end event
  const handleMapMoveEnd = () => {
      if (!mapRef.current) return;
      const mapCenter = mapRef.current.getCenter();
      const shiftedCenter = calculateShiftedCenter(mapCenter);
      if (shiftedCenter) {
          // Check mount status? (Less critical here, but good practice)
          setMarkerCenter({ lng: shiftedCenter.lng, lat: shiftedCenter.lat });
          updateNearestRoutes(shiftedCenter);
      }
  };

  // Updates the GeoJSON data in the map source
  const updateMapDataSource = () => {
    if (!mapRef.current || !mapRef.current.getSource("transit-route")) return;

    let featuresToShow = [];
    if (selectedRoute) {
      // If a route is selected, show only that route
      // Ensure selectedRoute is a valid GeoJSON Feature
       if (selectedRoute.type === 'Feature' && selectedRoute.geometry) {
           featuresToShow = [selectedRoute];
       } else {
           console.warn("Selected route is not a valid GeoJSON Feature:", selectedRoute);
       }
    } else {
      // Otherwise, show all features matching the current filters
      featuresToShow = transitRoute.features.filter(feature => {
        // Filter both lines and stops based on vehicleFilters
        const type = feature?.properties?.type?.replace('-Stop', '');
        // Ensure feature has geometry before including
        return type && vehicleFilters[type] && feature?.geometry;
      });
    }

    const newGeoJSON = {
      type: "FeatureCollection",
      features: featuresToShow,
    };
    // Use try-catch for setData as it can fail if map is removed concurrently
    try {
        mapRef.current.getSource("transit-route")?.setData(newGeoJSON);
    } catch(e) {
        console.error("Error setting map source data:", e);
    }
  };

  // Updates the visibility of layers based on filters (only when no route is selected)
  const updateLayerVisibility = () => {
      if (!mapRef.current) return;
      const stopLayers = ["mrt-stops", "lrt-stops", "bus-stops"]; // Add other stop layers if they exist
      const lineLayers = ["mrt-line", "lrt-line", "bus-lines", "p2p-bus-lines", "jeep-lines"]; // Add other line layers

      // Function to safely set layout property
      const safeSetLayoutProperty = (layerId, prop, value) => {
          if (mapRef.current?.getLayer(layerId)) {
              try {
                  mapRef.current.setLayoutProperty(layerId, prop, value);
              } catch (e) {
                  // console.warn(`Could not set layout property '${prop}' for layer '${layerId}':`, e.message);
              }
          }
      };


      if (selectedRoute) {
          // Hide all stops when a specific route is selected
          stopLayers.forEach(layerId => safeSetLayoutProperty(layerId, "visibility", "none"));
          // Optionally hide all lines except the selected one? (setData should handle this)
      } else {
          // Set visibility based on filters when nothing is selected
          safeSetLayoutProperty("mrt-stops", "visibility", vehicleFilters.MRT ? "visible" : "none");
          safeSetLayoutProperty("lrt-stops", "visibility", vehicleFilters.LRT ? "visible" : "none");
          safeSetLayoutProperty("bus-stops", "visibility", vehicleFilters.Bus ? "visible" : "none");
          // Add visibility toggles for P2P/Jeep stops if they exist

          safeSetLayoutProperty("mrt-line", "visibility", vehicleFilters.MRT ? "visible" : "none");
          safeSetLayoutProperty("lrt-line", "visibility", vehicleFilters.LRT ? "visible" : "none");
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
                try {
                    map.addLayer(layerConfig);
                } catch (e) {
                     console.error(`Failed to add layer '${layerConfig.id}':`, e);
                }
            }
        };

        // MRT Line
        safeAddLayer({ id: "mrt-line", type: "line", source: "transit-route", filter: ["==", ["get", "type"], "MRT"], layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#facc15", "line-width": 4 } });
        // MRT Stops
        safeAddLayer({ id: "mrt-stops", type: "circle", source: "transit-route", filter: ["==", ["get", "type"], "MRT-Stop"], paint: { "circle-radius": 5, "circle-color": "#facc15", "circle-stroke-color": "#fff", "circle-stroke-width": 1 } });
        // LRT Line
        safeAddLayer({ id: "lrt-line", type: "line", source: "transit-route", filter: ["==", ["get", "type"], "LRT"], layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#22c55e", "line-width": 4 } });
        // LRT Stops
        safeAddLayer({ id: "lrt-stops", type: "circle", source: "transit-route", filter: ["==", ["get", "type"], "LRT-Stop"], paint: { "circle-radius": 5, "circle-color": "#16a34a", "circle-stroke-color": "#fff", "circle-stroke-width": 1 } });
        // Jeep Lines
        safeAddLayer({ id: "jeep-lines", type: "line", source: "transit-route", filter: ["==", ["get", "type"], "Jeep"], layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#FFA500", "line-width": 3 } });
        // P2P Bus Lines
        safeAddLayer({ id: "p2p-bus-lines", type: "line", source: "transit-route", filter: ["==", ["get", "type"], "P2P-Bus"], layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#f97316", "line-width": 3 } });
        // Bus Lines
        safeAddLayer({ id: "bus-lines", type: "line", source: "transit-route", filter: ["==", ["get", "type"], "Bus"], layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#3b82f6", "line-width": 3 } });
        // Bus Stops
        safeAddLayer({ id: "bus-stops", type: "circle", source: "transit-route", filter: ["==", ["get", "type"], "Bus-Stop"], paint: { "circle-radius": 5, "circle-color": "#3b82f6", "circle-stroke-color": "#fff", "circle-stroke-width": 1 } });
  };

  // --- Distance Calculation ---
  // Uses Haversine formula for distance between two lat/lng points
  const calculateDistance = (point1, point2) => {
    // Added validation for input points
    if (!point1 || typeof point1.lat !== 'number' || typeof point1.lng !== 'number' ||
        !point2 || typeof point2.lat !== 'number' || typeof point2.lng !== 'number') {
         console.warn("Invalid input to calculateDistance:", point1, point2);
         return Infinity;
    }
    const R = 6371; // Radius of the Earth in km
    const dLat = ((point2.lat - point1.lat) * Math.PI) / 180;
    const dLon = ((point2.lng - point1.lng) * Math.PI) / 180;
    const lat1Rad = (point1.lat * Math.PI) / 180;
    const lat2Rad = (point2.lat * Math.PI) / 180;

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1Rad) * Math.cos(lat2Rad);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in km
  };

  // Calculates distance from center to nearest *vertex* on a feature
  const calculateNearestVertexDistance = (coordinates, center) => {
    if (!Array.isArray(coordinates) || coordinates.length === 0) return Infinity;

    return coordinates.reduce((minDist, coord) => {
        if (!Array.isArray(coord) || coord.length < 2 || typeof coord[0] !== 'number' || typeof coord[1] !== 'number') {
            console.warn("Skipping invalid coordinate in calculateNearestVertexDistance:", coord); return minDist;
        }
      const dist = calculateDistance({ lng: coord[0], lat: coord[1] }, center);
      return dist < minDist ? dist : minDist;
    }, Infinity);
  };

  // Calculates shortest distance from center point to any line segment of the coordinates
  const calculatePointToLineDistance = (coordinates, center) => {
    if (!Array.isArray(coordinates) || coordinates.length < 2) return Infinity;

    let minDistanceSq = Infinity;
    const cx = center.lng;
    const cy = center.lat;

    for (let i = 0; i < coordinates.length - 1; i++) {
        const p1 = coordinates[i];
        const p2 = coordinates[i + 1];
         if (!Array.isArray(p1) || p1.length < 2 || typeof p1[0] !== 'number' || typeof p1[1] !== 'number' ||
             !Array.isArray(p2) || p2.length < 2 || typeof p2[0] !== 'number' || typeof p2[1] !== 'number') {
             console.warn(`Skipping invalid segment in calculatePointToLineDistance: ${JSON.stringify(p1)} -> ${JSON.stringify(p2)}`); continue;
         }
        const x1 = p1[0], y1 = p1[1];
        const x2 = p2[0], y2 = p2[1];
        const lenSq = (x2 - x1) ** 2 + (y2 - y1) ** 2;
        if (lenSq === 0) { const distSq = (cx - x1) ** 2 + (cy - y1) ** 2; if (distSq < minDistanceSq) minDistanceSq = distSq; continue; }
        let t = ((cx - x1) * (x2 - x1) + (cy - y1) * (y2 - y1)) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const closestX = x1 + t * (x2 - x1);
        const closestY = y1 + t * (y2 - y1);
        const distSq = (cx - closestX) ** 2 + (cy - closestY) ** 2;
        if (distSq < minDistanceSq) minDistanceSq = distSq;
    }

    // Approximate conversion from squared degrees to km
    const degreesPerKmLat = 1 / 111.32;
    const degreesPerKmLon = 1 / (111.32 * Math.cos(center.lat * Math.PI / 180));
    const avgDegreesPerKm = (degreesPerKmLat + degreesPerKmLon) / 2;
    return Math.sqrt(minDistanceSq) / avgDegreesPerKm; // Approximate distance in km
  };

  // Updates the list of nearest routes based on the center point
  const updateNearestRoutes = (center) => {
    if (!center || typeof center.lng !== 'number' || typeof center.lat !== 'number') {
        console.error("Invalid center point provided to updateNearestRoutes:", center);
        return;
    }

    // --- MODIFICATION START: Filter out stops here ---
    const filteredFeatures = transitRoute.features.filter(feature => {
      const type = feature?.properties?.type; // Get the full type first
      const mode = type?.replace('-Stop', ''); // Get the base mode

      // Conditions to include a feature in the nearest list:
      // 1. Must have a valid type property.
      // 2. The base mode must be enabled in vehicleFilters.
      // 3. The type must NOT include '-Stop'.
      // 4. Must have valid geometry coordinates.
      return type &&
             mode &&
             vehicleFilters[mode] &&
             !type.includes('-Stop') && // *** Exclude stops ***
             feature?.geometry?.coordinates &&
             Array.isArray(feature.geometry.coordinates);
    });
    // --- MODIFICATION END ---

    const distances = filteredFeatures.map((feature) => {
      let distance = Infinity;
      const coords = feature.geometry.coordinates;
      // const type = feature.properties.type; // Already filtered, no need to check type here

      try {
          // Use point-to-line distance for all lines now
          if (feature.geometry.type === 'LineString') {
              distance = calculatePointToLineDistance(coords, center);
          }
          // Note: Point features (stops) are already excluded by the filter above
      } catch(e) {
          console.error(`Error calculating distance for feature ${feature?.properties?.name}:`, e);
          distance = Infinity;
      }

      return { ...feature, distance: (typeof distance === 'number' && !isNaN(distance)) ? distance : Infinity };
    });

    const validDistances = distances.filter(route => route.distance !== Infinity);
    const sortedRoutes = validDistances.sort((a, b) => a.distance - b.distance);
    setNearestRoutes(sortedRoutes.slice(0, 7));
  };

  // --- Event Handlers ---

  // Handles clicking on a route in the sidebar
  const handleRouteSelection = (route) => {
    if (!mapRef.current || !route?.geometry) return;

    if (selectedRoute === route) {
      setSelectedRoute(null);
    } else {
      setSelectedRoute(route);

      // --- Implement fitBounds ---
      try {
          // Validate geometry before calculating bbox
          if (route.geometry.type !== 'LineString' || !Array.isArray(route.geometry.coordinates) || route.geometry.coordinates.length < 2) {
               throw new Error("Selected route geometry is not a valid LineString.");
          }
          const bounds = turf.bbox(route.geometry);
          if (Array.isArray(bounds) && bounds.length === 4 && bounds.every(n => typeof n === 'number' && !isNaN(n))) {
              mapRef.current.fitBounds(bounds, {
                  padding: { top: 40, bottom: 40, left: 340, right: 40 },
                  maxZoom: 15, duration: 1000
              });
          } else {
              console.warn("Could not calculate valid bounds for selected route geometry:", bounds);
              // Fallback: Fly to mid-point
              const coordinates = route.geometry.coordinates;
              const routeCenter = coordinates[Math.floor(coordinates.length / 2)];
              if (Array.isArray(routeCenter) && routeCenter.length >= 2) {
                   mapRef.current.flyTo({ center: [routeCenter[0], routeCenter[1]], zoom: 12, essential: true });
              }
          }
      } catch (e) {
          console.error("Error calculating or fitting bounds:", e);
          // Fallback: Fly to mid-point on error
           const coordinates = route.geometry.coordinates;
           if (Array.isArray(coordinates) && coordinates.length > 0) {
               const routeCenter = coordinates[Math.floor(coordinates.length / 2)];
               if (Array.isArray(routeCenter) && routeCenter.length >= 2) {
                   mapRef.current.flyTo({ center: [routeCenter[0], routeCenter[1]], zoom: 12, essential: true });
               }
           }
      }
      // --- End fitBounds Implementation ---
    }
  };

  // Resets the selected route
  const handleResetSelection = () => {
    setSelectedRoute(null);
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
    // Use the modeColors map defined at the top
    return modeColors[type?.replace('-Stop', '')] || "#ccc"; // Added safety check for type
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
              <div style={{ marginBottom: "16px", fontSize: '0.9rem' }}>
                  {Object.keys(vehicleFilters).map((type) => (
                      <label key={type} style={{ display: "block", marginBottom: "5px", cursor: 'pointer' }}>
                          <input type="checkbox" checked={vehicleFilters[type]} onChange={() => handleFilterChange(type)} style={{ marginRight: "8px", cursor: 'pointer', verticalAlign: 'middle' }}/>
                          <span style={{verticalAlign: 'middle'}}>{type}</span>
                      </label>
                  ))}
              </div>
              <h2 style={{ marginBottom: "10px", fontSize: "1.15rem", fontWeight: "600" }}>Nearest Routes</h2>
          </div>

          {/* Scrollable List */}
          <div style={{flexGrow: 1, overflowY: 'auto', padding: '0 16px' /* Add padding here */ }}>
              <ul style={{ paddingLeft: "0", listStyle: "none", margin: 0 }}>
                  {nearestRoutes.length > 0 ? nearestRoutes.map((route, index) => (
                      <li
                          key={route.properties.name + index} // Use name + index for better key
                          onClick={() => handleRouteSelection(route)}
                          style={{
                              cursor: "pointer", marginBottom: "8px",
                              backgroundColor: getRouteColor(route.properties.type),
                              color: "#111", // Darker text for better contrast on light colors
                              padding: "10px 14px", borderRadius: "8px", fontWeight: "600", // Semi-bold
                              border: selectedRoute === route ? "3px solid #fff" : "3px solid transparent", // Thicker border
                              transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
                              boxShadow: selectedRoute === route ? '0 0 8px rgba(255, 255, 255, 0.7)' : 'none' // Glow effect
                          }}
                      >
                          <div style={{ fontSize: "1rem", marginBottom: '3px' }}>{route.properties.name}</div>
                          <div style={{ fontSize: ".9rem", fontWeight: "400", display: "flex", alignItems: "center", gap: "10px", marginTop: "4px", }}>
                              <span>{formatDistance(route.distance)}</span>
                              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                  <span className="material-icons" style={{ fontSize: "16px" }}>directions_walk</span>
                                  {formatWalkingTime(route.distance)}
                              </span>
                          </div>
                      </li>
                  )) : <li style={{color: '#aaa', padding: '10px 0'}}>No routes found nearby or matching filters.</li>}
              </ul>
          </div>

          {/* Bottom Button */}
          <div style={{padding: "16px", flexShrink: 0}}>
              <button onClick={handleResetSelection} disabled={!selectedRoute} style={{
                  padding: "10px 16px", width: '100%',
                  backgroundColor: selectedRoute ? "#dc2626" : '#6b7280', // Red when active, gray when disabled
                  color: "white", border: "none", borderRadius: "6px", cursor: selectedRoute ? "pointer" : 'not-allowed',
                  fontWeight: "bold", fontFamily: "Montserrat", opacity: selectedRoute ? 1 : 0.6, fontSize: '0.9rem'
              }}>
                  Reset Selection
              </button>
          </div>
      </div>

      {/* Legend */}
      <div style={{
          position: "absolute", top: "-5px", right: "16px", backgroundColor: "rgba(0, 0, 0, 0.8)",
          color: "white", padding: "10px 12px", borderRadius: "6px", zIndex: 10, boxShadow: "0 2px 4px rgba(0, 0, 0, 0.4)", fontSize: '1rem'
      }}>
          <h4 style={{ marginBottom: "8px", fontWeight: "bold", textAlign: "center", marginTop: 0, fontSize: '1rem' }}>Legend</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {Object.entries(modeColors) // Dynamically generate legend from modeColors
                  .filter(([mode]) => mode !== 'Walk' && mode !== 'Driving') // Exclude Walk/Driving from legend
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
          position: "absolute", top: "50%", left: "calc(50% + 150px)", // Adjust vertical position slightly?
          width: "24px", height: "24px", backgroundColor: "rgba(255, 0, 0, 0.8)",
          border: '2px solid white', borderRadius: "50% 50% 50% 0",
          transform: "translate(-50%, -100%) rotate(-45deg)", // Center horizontally, position tip at center
          transformOrigin: "center bottom",
          zIndex: 20, boxShadow: "0 0 8px rgba(0,0,0,0.6)",
          pointerEvents: 'none' // Prevent marker from intercepting map clicks
      }}/>
    </div>
  );
};

export default MapView;
