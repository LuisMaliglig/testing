import React, { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { awsConfig } from "../config/config"; // Ensure path is correct
import transitRoute from "../data/transit-lines.json"; // Ensure path is correct
import { useNavigate } from "react-router-dom";
import AWS from 'aws-sdk';
import logo from "../assets/logo.png"; // Ensure path is correct
import { buildSnappedRouteData } from "../components/routeUtils"; // Ensure path is correct

// Define mode colors for map layers
const modeColors = {
    MRT: "#facc15", // Yellow-400
    LRT1: "#22c55e", // Green-500
    LRT2: "#7A07D1", // Purple
    LRT: "#22c55e",   // Fallback LRT (using LRT1 color)
    Jeep: "#FFA500", // Orange
    "P2P-Bus": "#f97316", // Orange-500
    Bus: "#3b82f6", // Blue-500
    // Colors for stops if needed, can be same as line
    "MRT-Stop": "#facc15",
    "LRT1-Stop": "#22c55e",
    "LRT2-Stop": "#7A07D1",
    "Bus-Stop": "#3b82f6",
    "P2P-Bus-Stop": "#f97316",
    // Walk/Driving colors not needed for layers here
};


// Define coordinates for hardcoded route button
// Should be close to HARDCODED_ORIGIN_ALABANG and HARDCODED_DEST_BUENDIA in routeUtils.js
const HARDCODED_BUTTON_ORIGIN = { lat: 14.476, lng: 121.039 }; // Approx ATC Alabang
const HARDCODED_BUTTON_DEST = { lat: 14.557, lng: 121.007 }; // Approx Buendia/LRT

// Define initial map center state
const INITIAL_MAP_CENTER = { lng: 121.05, lat: 14.55 }; // Centered more on Metro Manila
const INITIAL_MAP_ZOOM = 11;


const NavView = () => {
  // --- State Variables ---
  const [awsReady, setAwsReady] = useState(false);
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const originMarkerRef = useRef(null);
  const destinationMarkerRef = useRef(null);
  const [originCoords, setOriginCoords] = useState(null);
  const [destinationCoords, setDestinationCoords] = useState(null);
  const [selectionMode, setSelectionMode] = useState('origin');
  const [processedRoutes, setProcessedRoutes] = useState(null);
  const [displayRouteStrings, setDisplayRouteStrings] = useState([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(null);
  const [awsRouteData, setAwsRouteData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [instructionText, setInstructionText] = useState("Click on the map to select Origin");

  const navigate = useNavigate();

  // --- Effects ---

  // Effect for AWS Credentials
  useEffect(() => {
    AWS.config.region = awsConfig.region;
    const credentials = new AWS.CognitoIdentityCredentials({
      IdentityPoolId: awsConfig.identityPoolId,
    });
    AWS.config.credentials = credentials;
    credentials.get((err) => {
      if (err) { console.error("Error retrieving AWS credentials:", err); setErrorMsg("Error loading AWS credentials."); }
      else { console.log("AWS credentials loaded"); setAwsReady(true); }
    });
  }, []);

  // Function to add or update map markers
  const updateMarker = (lngLat, type) => {
    if (!mapRef.current || !lngLat) return;

    const markerOptions = { color: type === 'origin' ? "#00FF00" : "#FF0000", draggable: false };

    if (type === 'origin') {
        originMarkerRef.current?.remove();
        originMarkerRef.current = new maplibregl.Marker(markerOptions).setLngLat([lngLat.lng, lngLat.lat]).addTo(mapRef.current);
    } else if (type === 'destination') {
        destinationMarkerRef.current?.remove();
        destinationMarkerRef.current = new maplibregl.Marker(markerOptions).setLngLat([lngLat.lng, lngLat.lat]).addTo(mapRef.current);
    }
  };

  // Map click handler
  const handleMapClick = useCallback((e) => {
    const coords = e.lngLat;
    console.log(`Map clicked at: ${coords.lat}, ${coords.lng}`);
    if (isLoading) return;

    if (selectionMode === 'origin' || selectionMode === 'done') { // Allow restarting by clicking origin
        setOriginCoords(coords); updateMarker(coords, 'origin');
        setDestinationCoords(null); destinationMarkerRef.current?.remove();
        setSelectionMode('destination'); setInstructionText('Click on the map to select Destination');
        setProcessedRoutes(null); setDisplayRouteStrings([]); setSelectedRouteIndex(null); setAwsRouteData(null); setErrorMsg("");
    } else if (selectionMode === 'destination') {
        if (originCoords && coords.lng === originCoords.lng && coords.lat === originCoords.lat) {
             setErrorMsg("Origin and Destination cannot be the same point."); return;
        }
        setDestinationCoords(coords); updateMarker(coords, 'destination');
        setSelectionMode('done'); setInstructionText('Origin & Destination selected. Click "Suggest Routes".'); setErrorMsg("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, selectionMode, originCoords]); // Removed updateMarker from deps

  // --- Function to Add Transit Layers ---
  const addAllLayers = (map) => {
    // Function to safely add layer
    const safeAddLayer = (layerConfig) => {
        if (!map.getLayer(layerConfig.id)) {
            try { map.addLayer(layerConfig); }
            catch (e) { console.error(`Failed to add layer '${layerConfig.id}':`, e); }
        }
    };
    // Define layer configurations including LRT1/LRT2 stops
    const layers = [
        { id: "mrt-line", type: "line", filter: ["==", ["get", "type"], "MRT"], paint: { "line-color": modeColors.MRT, "line-width": 4 } },
        { id: "lrt1-line", type: "line", filter: ["==", ["get", "type"], "LRT1"], paint: { "line-color": modeColors.LRT1, "line-width": 4 } },
        { id: "lrt2-line", type: "line", filter: ["==", ["get", "type"], "LRT2"], paint: { "line-color": modeColors.LRT2, "line-width": 4 } },
        { id: "jeep-lines", type: "line", filter: ["==", ["get", "type"], "Jeep"], paint: { "line-color": modeColors.Jeep, "line-width": 3, 'line-opacity': 0.7 } },
        { id: "p2p-bus-lines", type: "line", filter: ["==", ["get", "type"], "P2P-Bus"], paint: { "line-color": modeColors['P2P-Bus'], "line-width": 3 } },
        { id: "bus-lines", type: "line", filter: ["==", ["get", "type"], "Bus"], paint: { "line-color": modeColors.Bus, "line-width": 3 } },
        { id: "mrt-stops", type: "circle", filter: ["==", ["get", "type"], "MRT-Stop"], paint: { "circle-radius": 4, "circle-color": modeColors.MRT, "circle-stroke-color": "#fff", "circle-stroke-width": 1 } },
        { id: "lrt1-stops", type: "circle", filter: ["==", ["get", "type"], "LRT1-Stop"], paint: { "circle-radius": 4, "circle-color": modeColors.LRT1, "circle-stroke-color": "#fff", "circle-stroke-width": 1 } },
        { id: "lrt2-stops", type: "circle", filter: ["==", ["get", "type"], "LRT2-Stop"], paint: { "circle-radius": 4, "circle-color": modeColors.LRT2, "circle-stroke-color": "#fff", "circle-stroke-width": 1 } },
        { id: "bus-stops", type: "circle", filter: ["==", ["get", "type"], "Bus-Stop"], paint: { "circle-radius": 4, "circle-color": modeColors.Bus, "circle-stroke-color": "#fff", "circle-stroke-width": 1 } },
         // Add P2P stops layer if needed
        // { id: "p2p-bus-stops", type: "circle", filter: ["==", ["get", "type"], "P2P-Bus-Stop"], paint: { "circle-radius": 4, "circle-color": modeColors['P2P-Bus'], "circle-stroke-color": "#fff", "circle-stroke-width": 1 } },
    ];

    // Add each layer
    layers.forEach(layer => {
        // Define common layout properties here, remove from individual definitions if consistent
        const layoutProps = layer.type === 'line' ? { "line-join": "round", "line-cap": "round" } : {};
        safeAddLayer({
            ...layer,
            source: "transit-route", // Use the common source
            layout: layoutProps,
        });
    });
    console.log("Transit layers added to map.");
  };

  // Effect for Map Setup
  useEffect(() => {
    if (!mapContainerRef.current) return;
    let isMounted = true;
    const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: `https://maps.geo.${awsConfig.region}.amazonaws.com/maps/v0/maps/${awsConfig.mapName}/style-descriptor?key=${awsConfig.apiKey}`,
        center: [INITIAL_MAP_CENTER.lng, INITIAL_MAP_CENTER.lat], // Use constant
        zoom: INITIAL_MAP_ZOOM, // Use constant
     });
    mapRef.current = map;

    map.on("load", () => {
        if (!mapRef.current || !isMounted) return;
        console.log("Map loaded.");
        // --- ADD SOURCE AND LAYERS ---
        if (!mapRef.current.getSource("transit-route")) {
            mapRef.current.addSource("transit-route", { type: "geojson", data: transitRoute }); // Load full data
            console.log("Source 'transit-route' added.");
        }
        addAllLayers(map); // Add the layers
        // -----------------------------
        map.on('click', handleMapClick);
    });
    map.on('error', (e) => console.error("MapLibre Error:", e));
    // Cleanup
    return () => {
        isMounted = false;
        if (mapRef.current) {
            if (mapRef.current.getStyle()) { mapRef.current.off('click', handleMapClick); }
            mapRef.current.remove(); mapRef.current = null;
            console.log("Map removed on cleanup");
        }
        originMarkerRef.current?.remove();
        destinationMarkerRef.current?.remove();
     };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awsReady, handleMapClick]); // Dependencies


  // --- Route Calculation Logic ---

  // *** Calculation function that accepts coords (now async) ***
  const handleRouteSuggestionForCoords = useCallback(async (oCoords, dCoords) => { // Added async
      setErrorMsg("");
      if (!oCoords || !dCoords) { setErrorMsg("Internal error: Missing coordinates for calculation."); return; }
      if (!awsReady || !AWS.config.credentials?.accessKeyId) { setErrorMsg("AWS services not ready."); return; }

      setIsLoading(true); setAwsRouteData(null); setProcessedRoutes(null); setDisplayRouteStrings([]); setSelectedRouteIndex(null);
      setInstructionText('Calculating driving route...'); // Update instruction

      try {
          const routeCalculator = new AWS.Location();
          const params = {
              CalculatorName: awsConfig.routeCalculatorName,
              DeparturePosition: [oCoords.lng, oCoords.lat],
              DestinationPosition: [dCoords.lng, dCoords.lat],
              IncludeLegGeometry: true,
          };
          console.log("Calculating route with params:", params);
          const data = await routeCalculator.calculateRoute(params).promise();
          console.log("AWS Route Data Received:", data);
          // Update state ONLY IF component is still mounted (check less critical here as it triggers another effect)
          setAwsRouteData(data); // Trigger processing effect
          setInstructionText('Calculating transit options...'); // Update instruction
      } catch (error) {
          console.error("Error calculating AWS route:", error);
          setErrorMsg(`Error calculating route: ${error.message || 'Please try again.'}`);
          setAwsRouteData(null); setIsLoading(false);
          setInstructionText('Calculation failed. Click map to select new Origin.');
      }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awsReady]); // Dependencies

  // Function to Handle Route Calculation Request (Main button)
  const handleRouteSuggestion = () => { // No longer async itself
    if (!originCoords || !destinationCoords) { setErrorMsg("Please select both Origin and Destination on the map."); return; }
    // Call the async helper
    handleRouteSuggestionForCoords(originCoords, destinationCoords);
  };

  // Handler for Hardcoded Route Button
  const handleHardcodedRoute = () => {
      console.log("Triggering hardcoded Alabang -> Buendia route...");
      setErrorMsg("");
      const origin = HARDCODED_BUTTON_ORIGIN;
      const destination = HARDCODED_BUTTON_DEST;
      setOriginCoords(origin); // Update state
      setDestinationCoords(destination); // Update state
      updateMarker(origin, 'origin'); // Update map marker
      updateMarker(destination, 'destination'); // Update map marker
      setSelectionMode('done'); // Ensure mode is correct
      // Call the async helper
      handleRouteSuggestionForCoords(origin, destination);
  }


  // *** Effect to Process AWS Data and Calculate Snapped Routes (NOW ASYNC) ***
  useEffect(() => {
    // Define async function inside effect
    const processAndSnapRoutes = async () => {
      if (awsRouteData && awsRouteData.Legs && awsRouteData.Legs.length > 0) {
        console.log("Processing AWS data and snapping routes...");
        // Ensure loading is true while snapping
        if (!isLoading) setIsLoading(true);
         setInstructionText('Analyzing transit options...');
        try {
          // *** Await the result of buildSnappedRouteData ***
          const snapped = await buildSnappedRouteData(awsRouteData, transitRoute.features);
          console.log("Snapped routes calculated:", snapped);

          // Check if component is still mounted before setting state
          if (!snapped || snapped.length === 0) { throw new Error("Snapping process returned no valid routes."); }

          setProcessedRoutes(snapped); // Store structured data
          const displayStrings = snapped.map((route, index) => route?.properties?.label || `Route ${index + 1}`);
          setDisplayRouteStrings(displayStrings);
          let defaultIndex = 0;
          const firstTransitIndex = snapped.findIndex(route => route?.properties?.primary_mode !== 'Driving');
          if (firstTransitIndex !== -1) { defaultIndex = firstTransitIndex; }
          setSelectedRouteIndex(defaultIndex);
          setInstructionText('Calculation complete. Click map to select new Origin.');

        } catch (error) {
           console.error("Error processing/snapping route data:", error);
           setErrorMsg(`Error processing route: ${error.message || 'Failed.'}`);
           setProcessedRoutes(null); setDisplayRouteStrings([]); setSelectedRouteIndex(null);
           setInstructionText('Processing failed. Click map to select new Origin.');
        } finally {
           // Check mount status before setting state
           setIsLoading(false);
        }
      } else if (awsRouteData) { // AWS call finished but no legs
         console.warn("AWS route data received but contains no Legs.");
         setErrorMsg("Route calculation returned no path.");
         setIsLoading(false);
         setInstructionText('Calculation failed (no path). Click map to select new Origin.');
      }
    };

    // Call the async function if awsRouteData is present
    if (awsRouteData) {
        processAndSnapRoutes();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awsRouteData]); // Dependency: Only run when awsRouteData changes


  // Effect to Navigate WHEN processedRoutes is ready AND user hasn't re-clicked map
  useEffect(() => {
    // Navigate only when results are processed and selection is 'done'
    if (processedRoutes && processedRoutes.length > 0 && selectedRouteIndex !== null && awsRouteData && selectionMode === 'done') {
        console.log(`Navigating to /route-breakdown with selected index: ${selectedRouteIndex}`);
        const originString = originCoords ? `${originCoords.lat},${originCoords.lng}` : "";
        const destinationString = destinationCoords ? `${destinationCoords.lat},${destinationCoords.lng}` : "";
        navigate("/route-breakdown", {
            state: { origin: originString, destination: destinationString, suggestedRoutes: processedRoutes,
                     selectedRouteIndex: selectedRouteIndex, awsRouteData, snappedRoutes: processedRoutes },
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processedRoutes, selectedRouteIndex, awsRouteData, selectionMode]);


  // --- JSX Return Statement ---
  return (
    <div style={{ position: "relative", height: "100vh", fontFamily: "Montserrat, sans-serif" }}>
      {/* Map Container */}
      <div ref={mapContainerRef} style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}/>
      {/* Overlay UI Panel */}
      <div style={{
          position: "absolute", top: "20px", left: "20px", width: "340px",
          maxHeight: "calc(100vh - 40px)", backgroundColor: "rgba(0, 0, 0, 0.75)",
          backdropFilter: "blur(5px)", color: "white", zIndex: 10, borderRadius: "8px",
          boxShadow: "0 4px 15px rgba(0, 0, 0, 0.3)", display: "flex", flexDirection: "column",
      }}>
        {/* Panel Header */}
        <div style={{ padding: "16px", borderBottom: '1px solid rgba(255, 255, 255, 0.2)', flexShrink: 0 }}>
           <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <img src={logo} alt="Logo" style={{ width: "40px", height: "40px", cursor: "pointer" }} onClick={() => navigate("/")}/>
                <button onClick={() => navigate("/nav-view")} style={{ padding: "8px 14px", backgroundColor: "#1e40af", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: '0.9rem' }}>
                  Nav View
                </button>
           </div>
           <h1 style={{ fontSize: "1.3rem", fontWeight: "600", margin: 0 }}>
             Select Route
           </h1>
        </div>

        {/* Panel Content (Scrollable) */}
        <div style={{ padding: "16px", overflowY: 'auto', flexGrow: 1 }}>

            {/* Instructions & Status */}
            <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: 'rgba(255, 255, 255, 0.1)', borderRadius: '5px', fontSize: '0.9rem', textAlign: 'center' }}>
                {instructionText}
            </div>

            {/* Display Selected Coords */}
            <div style={{ fontSize: '0.8rem', marginBottom: '15px', color: '#d1d5db', padding: '8px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '4px' }}>
                <div><strong>Origin:</strong> {originCoords ? `${originCoords.lat.toFixed(5)}, ${originCoords.lng.toFixed(5)}` : 'Not selected'}</div>
                <div><strong>Destination:</strong> {destinationCoords ? `${destinationCoords.lat.toFixed(5)}, ${destinationCoords.lng.toFixed(5)}` : 'Not selected'}</div>
            </div>

            {/* Error Message Display */}
            {errorMsg && (
                <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: 'rgba(255, 0, 0, 0.3)', borderRadius: '5px', fontSize: '0.9rem', color: '#fca5a5', textAlign: 'center' }}>
                    {errorMsg}
                </div>
            )}

            {/* Suggest Button */}
            <button
              onClick={handleRouteSuggestion}
              disabled={isLoading || selectionMode !== 'done'}
              style={{
                width: "100%", height: "45px",
                backgroundColor: (selectionMode === 'done' && !isLoading) ? "#1e40af" : '#4b5563',
                color: "#fff", border: "none", borderRadius: "5px", cursor: (selectionMode === 'done' && !isLoading) ? "pointer" : 'not-allowed',
                fontSize: "1rem", fontWeight: '600',
                opacity: (selectionMode === 'done' && !isLoading) ? 1 : 0.6,
                transition: 'background-color 0.2s ease, opacity 0.2s ease',
                marginBottom: '10px' // Add margin below
              }}
            >
              {isLoading ? "Calculating..." : "Suggest Routes"}
            </button>

            {/* --- Hardcoded Route Button --- */}
            <button
              onClick={handleHardcodedRoute}
              disabled={isLoading} // Disable only when loading
              style={{
                width: "100%", height: "40px", // Slightly smaller
                backgroundColor: isLoading ? '#4b5563' : '#4a5568', // Darker gray/indigo
                color: "#cbd5e1", // Lighter text
                border: "1px solid #4a5568", // Subtle border
                borderRadius: "5px", cursor: isLoading ? "not-allowed" : "pointer",
                fontSize: "0.85rem", fontWeight: '600', // Slightly smaller font
                opacity: isLoading ? 0.6 : 1,
                transition: 'background-color 0.2s ease, opacity 0.2s ease'
              }}
            >
              {isLoading ? "Calculating..." : "Test: Alabang ➔ Buendia Multi-Modal"}
            </button>
            {/* --- END Hardcoded Route Button --- */}

        </div> {/* End Panel Content */}
      </div> {/* End Overlay UI Panel */}
    </div> // End Root Div
  );
};

export default NavView;
