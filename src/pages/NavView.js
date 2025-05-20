import React, { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { awsConfig } from "../config/config";
import transitRoute from "../data/transit-lines.json";
import { useNavigate } from "react-router-dom";
import AWS from 'aws-sdk';
import logo from "../assets/logo.png";
import { buildSnappedRouteData } from "../components/routeUtils";

// Define mode colors for map layers
const modeColors = {
    MRT: "#facc15",
    LRT1: "#22c55e",
    LRT2: "#7A07D1",
    Jeep: "#FFA500",
    "P2P-Bus": "#f97316",
    Bus: "#3b82f6",
    "MRT-Stop": "#facc15",
    "LRT1-Stop": "#22c55e",
    "LRT2-Stop": "#7A07D1",
    "Bus-Stop": "#3b82f6",
    "P2P-Bus-Stop": "#f97316",
};

// Define initial map center state
const INITIAL_MAP_CENTER = { lng: 121.05, lat: 14.55 };
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

    if (selectionMode === 'origin' || selectionMode === 'done') {
        setOriginCoords(coords); updateMarker(coords, 'origin');
        setDestinationCoords(null); destinationMarkerRef.current?.remove();
        setSelectionMode('destination'); setInstructionText('Click on the map to select Destination');
        setProcessedRoutes(null); setSelectedRouteIndex(null); setAwsRouteData(null); setErrorMsg("");
    } else if (selectionMode === 'destination') {
        if (originCoords && coords.lng === originCoords.lng && coords.lat === originCoords.lat) {
            setErrorMsg("Origin and Destination cannot be the same point."); return;
        }
        setDestinationCoords(coords); updateMarker(coords, 'destination');
        setSelectionMode('done'); setInstructionText('Origin & Destination selected. Click "Suggest Routes".'); setErrorMsg("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, selectionMode, originCoords]);

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
        { id: "p2p-bus-stops", type: "circle", filter: ["==", ["get", "type"], "P2P-Bus-Stop"], paint: { "circle-radius": 4, "circle-color": modeColors['P2P-Bus'], "circle-stroke-color": "#fff", "circle-stroke-width": 1 } },
    ];

    // Add each layer
    layers.forEach(layer => {
        // Define common layout properties here, remove from individual definitions if consistent
        const layoutProps = layer.type === 'line' ? { "line-join": "round", "line-cap": "round" } : {};
        safeAddLayer({
            ...layer,
            source: "transit-route",
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
        center: [INITIAL_MAP_CENTER.lng, INITIAL_MAP_CENTER.lat],
        zoom: INITIAL_MAP_ZOOM,
      });
    mapRef.current = map;

    map.on("load", () => {
        if (!mapRef.current || !isMounted) return;
        console.log("Map loaded.");
        // --- ADD SOURCE AND LAYERS ---
        if (!mapRef.current.getSource("transit-route")) {
            mapRef.current.addSource("transit-route", { type: "geojson", data: transitRoute });
            console.log("Source 'transit-route' added.");
        }
        addAllLayers(map);
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
  }, [awsReady, handleMapClick]);


  // --- Route Calculation Logic ---

  // *** Calculation function that accepts coords (now async) ***
  const handleRouteSuggestionForCoords = useCallback(async (oCoords, dCoords) => {
      setErrorMsg("");
      if (!oCoords || !dCoords) { setErrorMsg("Internal error: Missing coordinates for calculation."); return; }
      if (!awsReady || !AWS.config.credentials?.accessKeyId) { setErrorMsg("AWS services not ready."); return; }

      setIsLoading(true); setAwsRouteData(null); setProcessedRoutes(null); setSelectedRouteIndex(null);
      setInstructionText('Calculating driving route...');

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
          setAwsRouteData(data);
          setInstructionText('Calculating transit options...');
      } catch (error) {
          console.error("Error calculating AWS route:", error);
          setErrorMsg(`Error calculating route: ${error.message || 'Please try again.'}`);
          setAwsRouteData(null); setIsLoading(false);
          setInstructionText('Calculation failed. Click map to select new Origin.');
      }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awsReady]);

  // Function to Handle Route Calculation Request (Main button)
  const handleRouteSuggestion = () => {
    if (!originCoords || !destinationCoords) { setErrorMsg("Please select both Origin and Destination on the map."); return; }
    // Call the async helper
    handleRouteSuggestionForCoords(originCoords, destinationCoords);
  };

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

          setProcessedRoutes(snapped);
          let defaultIndex = 0;
          const firstTransitIndex = snapped.findIndex(route => route?.properties?.primary_mode !== 'Driving');
          if (firstTransitIndex !== -1) { defaultIndex = firstTransitIndex; }
          setSelectedRouteIndex(defaultIndex);
          setInstructionText('Calculation complete. Click map to select new Origin.');

        } catch (error) {
            console.error("Error processing/snapping route data:", error);
            setErrorMsg(`Error processing route: ${error.message || 'Failed.'}`);
            setProcessedRoutes(null); setSelectedRouteIndex(null);
            setInstructionText('Processing failed. Click map to select new Origin.');
        } finally {
            // Check mount status before setting state
            setIsLoading(false);
        }
      } else if (awsRouteData) {
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
  }, [awsRouteData, isLoading]);


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
  }, [processedRoutes, selectedRouteIndex, awsRouteData, selectionMode, originCoords, destinationCoords, navigate]);

    const isMobile = window.innerWidth <= 640;

  // --- JSX Return Statement ---

  return (
    <div style={{ position: "relative", height: "100vh", fontFamily: "Montserrat, sans-serif" }}>
      {/* Map Container */}
      <div ref={mapContainerRef} style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }} />

      {/* Overlay UI Panel */}
      <div style={{
        position: "absolute",
        top: isMobile ? "unset" : "20px",
        bottom: isMobile ? 0 : "unset",
        left: isMobile ? 0 : "20px",
        right: isMobile ? 0 : "unset",
        width: isMobile ? "100%" : "340px",
        maxHeight: isMobile ? "50%" : "calc(100vh - 40px)",
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(5px)",
        color: "white",
        zIndex: 10,
        borderRadius: isMobile ? "0px" : "5px",
        boxShadow: "0 4px 15px rgba(0, 0, 0, 0.3)",
        display: "flex",
        flexDirection: "column"
      }}>
        {/* Panel Header */}
        <div style={{
          padding: isMobile ? "12px" : "16px",
          borderBottom: '1px solid rgba(255, 255, 255, 0.2)',
          flexShrink: 0
        }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "10px"
          }}>
            <img src={logo} alt="Logo" style={{ width: "36px", height: "36px", cursor: "pointer" }} onClick={() => navigate("/")} />
            <button onClick={() => navigate("/map-view")} style={{
              padding: "6px 12px",
              backgroundColor: "#1e40af",
              color: "#fff",
              border: "none",
              borderRadius: "5px",
              cursor: "pointer",
              fontSize: '0.8rem'
            }}>
              Map View
            </button>
          </div>
          <h1 style={{ fontSize: "1.2rem", fontWeight: "600", margin: 0 }}>Select Route</h1>
        </div>

        {/* Panel Content */}
        <div style={{
          padding: "14px",
          overflowY: 'auto',
          flexGrow: 1
        }}>
          <div style={{
            marginBottom: '12px',
            padding: '10px',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            borderRadius: '5px',
            fontSize: '0.85rem',
            textAlign: 'center'
          }}>
            {instructionText}
          </div>

          <div style={{
            fontSize: '0.75rem',
            marginBottom: '12px',
            color: '#d1d5db',
            padding: '8px',
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderRadius: '5px'
          }}>
            <div><strong>Origin:</strong> {originCoords ? `${originCoords.lat.toFixed(5)}, ${originCoords.lng.toFixed(5)}` : 'Not selected'}</div>
            <div><strong>Destination:</strong> {destinationCoords ? `${destinationCoords.lat.toFixed(5)}, ${destinationCoords.lng.toFixed(5)}` : 'Not selected'}</div>
          </div>

          {errorMsg && (
            <div style={{
              marginBottom: '12px',
              padding: '10px',
              backgroundColor: 'rgba(255, 0, 0, 0.3)',
              borderRadius: '5px',
              fontSize: '0.85rem',
              color: '#fca5a5',
              textAlign: 'center'
            }}>
              {errorMsg}
            </div>
          )}

          <button
            onClick={handleRouteSuggestion}
            disabled={isLoading || selectionMode !== 'done'}
            style={{
              width: "100%",
              height: "42px",
              backgroundColor: (selectionMode === 'done' && !isLoading) ? "#1e40af" : '#4b5563',
              color: "#fff",
              border: "none",
              borderRadius: "5px",
              cursor: (selectionMode === 'done' && !isLoading) ? "pointer" : 'not-allowed',
              fontSize: "0.95rem",
              fontWeight: '600',
              opacity: (selectionMode === 'done' && !isLoading) ? 1 : 0.6,
              transition: 'background-color 0.2s ease, opacity 0.2s ease',
              marginBottom: '8px'
            }}
          >
            {isLoading ? "Calculating..." : "Suggest Routes"}
          </button>
        </div>
      </div>

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
    </div>
  );
};

export default NavView;