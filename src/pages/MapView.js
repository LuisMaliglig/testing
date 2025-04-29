import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useNavigate } from "react-router-dom";
import transitRoute from "../data/transit-lines.json";
import { awsConfig } from "../config/config";
import logo from "../assets/logo.png";

const MapView = () => {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [nearestRoutes, setNearestRoutes] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [markerCenter, setMarkerCenter] = useState({ lng: 121.0357, lat: 14.4981 });
  const navigate = useNavigate();
  const formatDistance = (km) => {
    return km < 1 ? `${(km * 1000).toFixed(0)} m` : `${km.toFixed(2)} km`;
  };

  const formatWalkingTime = (km) => {
    const minutes = Math.round((km / 5) * 60);
    return `${minutes} min`;
  };
  
  useEffect(() => {
  const link = document.createElement('link');
  link.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
  link.rel = 'stylesheet';
  document.head.appendChild(link);

  return () => {
    document.head.removeChild(link);
    };
  }, []);

  useEffect(() => {
    const montserrat = document.createElement('link');
    montserrat.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600&display=swap';
    montserrat.rel = 'stylesheet';
    document.head.appendChild(montserrat);
  
    return () => {
      document.head.removeChild(montserrat);
    };
  }, []);  

  useEffect(() => {
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: `https://maps.geo.${awsConfig.region}.amazonaws.com/maps/v0/maps/${awsConfig.mapName}/style-descriptor?key=${awsConfig.apiKey}`,
      center: [markerCenter.lng, markerCenter.lat],
      zoom: 11,
    });

    mapRef.current = map;

    map.on("load", () => {
      map.addSource("transit-route", {
        type: "geojson",
        data: transitRoute,
      });

      addAllLayers(map);

      map.on("moveend", () => {
        const mapCenter = map.getCenter();
        const centerScreenPoint = map.project(mapCenter);
        centerScreenPoint.x += 150; // Shift 150px right
        const shiftedCenter = map.unproject(centerScreenPoint);

        setMarkerCenter({ lng: shiftedCenter.lng, lat: shiftedCenter.lat });
        updateNearestRoutes(shiftedCenter);
      });

      const initialCenter = map.getCenter();
      const initialScreenPoint = map.project(initialCenter);
      initialScreenPoint.x += 150;
      const initialShiftedCenter = map.unproject(initialScreenPoint);

      setMarkerCenter({ lng: initialShiftedCenter.lng, lat: initialShiftedCenter.lat });
      updateNearestRoutes(initialShiftedCenter);
    });

    return () => map.remove();
  }, []);

  useEffect(() => {
    if (!mapRef.current?.getStyle()) return;
  
    if (selectedRoute) {
      // Show only the selected route
      const selectedGeoJSON = {
        type: "FeatureCollection",
        features: [selectedRoute],
      };
  
      if (mapRef.current.getSource("transit-route")) {
        mapRef.current.getSource("transit-route").setData(selectedGeoJSON);
      }
    } else {
      if (mapRef.current.getSource("transit-route")) {
        mapRef.current.getSource("transit-route").setData(transitRoute);
      }
      if (mapRef.current.getLayer("lrt-stops")) {
        mapRef.current.setLayoutProperty("lrt-stops", "visibility", "visible");
      }
      if (mapRef.current.getLayer("bus-stops")) {
        mapRef.current.setLayoutProperty("bus-stops", "visibility", "visible");
      }
    }
  }, [selectedRoute]);
  
  

  const addAllLayers = (map) => {
    map.addLayer({
      id: "mrt-line",
      type: "line",
      source: "transit-route",
      filter: ["==", ["get", "type"], "MRT"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#facc15", "line-width": 4 },
    });

    map.addLayer({
      id: "mrt-stops",
      type: "circle",
      source: "transit-route",
      filter: ["==", ["get", "type"], "MRT-Stop"],
      paint: {
        "circle-radius": 5,
        "circle-color": "#facc15",
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 1,
      },
    });

    map.addLayer({
      id: "lrt-line",
      type: "line",
      source: "transit-route",
      filter: ["==", ["get", "type"], "LRT"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#22c55e", "line-width": 4 },
    });

    map.addLayer({
      id: "lrt-stops",
      type: "circle",
      source: "transit-route",
      filter: ["==", ["get", "type"], "LRT-Stop"],
      paint: {
        "circle-radius": 5,
        "circle-color": "#16a34a",
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 1,
      },
    });

    map.addLayer({
      id: "jeep-lines",
      type: "line",
      source: "transit-route",
      filter: ["==", ["get", "type"], "Jeep"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#FFA500", "line-width": 3 },
    });

    map.addLayer({
      id: "p2p-bus-lines",
      type: "line",
      source: "transit-route",
      filter: ["==", ["get", "type"], "P2P-Bus"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#f97316", "line-width": 3 },
    });

    map.addLayer({
      id: "bus-lines",
      type: "line",
      source: "transit-route",
      filter: ["==", ["get", "type"], "Bus"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#3b82f6", "line-width": 3 },
    });

    map.addLayer({
      id: "bus-stops",
      type: "circle",
      source: "transit-route",
      filter: ["==", ["get", "type"], "Bus-Stop"],
      paint: {
        "circle-radius": 5,
        "circle-color": "#3b82f6",
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 1,
      },
    });
  };

  const calculateDistance = (point1, point2) => {
    const R = 6371;
    const dLat = ((point2.lat - point1.lat) * Math.PI) / 180;
    const dLon = ((point2.lng - point1.lng) * Math.PI) / 180;
    const lat1 = (point1.lat * Math.PI) / 180;
    const lat2 = (point2.lat * Math.PI) / 180;

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const calculateNearestStopDistance = (coordinates, center) => {
    if (!coordinates || coordinates.length === 0) return Infinity;

    return coordinates.reduce((minDist, coord) => {
      const dist = calculateDistance({ lng: coord[0], lat: coord[1] }, center);
      return dist < minDist ? dist : minDist;
    }, Infinity);
  };

  const calculateRouteLineDistance = (coordinates, center) => {
    if (!coordinates || coordinates.length < 2) return Infinity;

    let minDistance = Infinity;
    for (let i = 0; i < coordinates.length - 1; i++) {
      const [x1, y1] = coordinates[i];
      const [x2, y2] = coordinates[i + 1];

      const A = center.lng - x1;
      const B = center.lat - y1;
      const C = x2 - x1;
      const D = y2 - y1;

      const dot = A * C + B * D;
      const len_sq = C * C + D * D;
      const param = len_sq !== 0 ? dot / len_sq : -1;

      let xx, yy;
      if (param < 0) {
        xx = x1;
        yy = y1;
      } else if (param > 1) {
        xx = x2;
        yy = y2;
      } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
      }

      const dist = calculateDistance({ lng: xx, lat: yy }, center);
      if (dist < minDistance) minDistance = dist;
    }

    return minDistance;
  };

  const updateNearestRoutes = (center) => {
    const distances = transitRoute.features.map((route) => {
      let distance = 0;
      const coords = route.geometry.coordinates;

      if (route.properties.type === "MRT" || route.properties.type === "MRT-Stop" || route.properties.type === "LRT" || route.properties.type === "LRT-Stop" || route.properties.type === "Bus" || route.properties.type === "Bus-Stop" || route.properties.type === "P2P-Bus") {
        distance = calculateNearestStopDistance(coords, center);
      } else if (route.properties.type === "Jeep") {
        distance = calculateRouteLineDistance(coords, center);
      }

      return { ...route, distance };
    });

    const sortedRoutes = distances.sort((a, b) => a.distance - b.distance);
    setNearestRoutes(sortedRoutes.slice(0, 7));
  };

  const handleRouteSelection = (route) => {
    if (selectedRoute === route) {
      setSelectedRoute(null); // Deselect if clicking again
    } else {
      setSelectedRoute(route);
  
      // Get the route's coordinates and calculate its center
      const coordinates = route.geometry.coordinates;
      const routeCenter = coordinates[Math.floor(coordinates.length / 2)]; 
  
      // Pan the map to the selected route center
      mapRef.current.flyTo({
        center: [routeCenter[0], routeCenter[1]], 
        zoom: 12,
        essential: true, 
      });
    }
  };

  const handleResetSelection = () => {
    setSelectedRoute(null); 
  };
  
  

  const getRouteColor = (type) => {
    switch (type) {
      case "P2P-Bus":
        return "#f97316";
      case "Bus":
      case "Bus-Stop":
        return "#3b82f6";
      case "MRT":
      case "MRT-Stop":
        return "#facc15"; 
      case "LRT":
      case "LRT-Stop":
        return "#22c55e"; 
      case "Jeep":
        return "#FFA500";
      default:
        return "#ccc"; 
    }
  };

  return (
    <div style={{ position: "relative", height: "100vh", fontFamily: "Montserrat, sans-serif" }}>
      {/* Sidebar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          height: "100%",
          width: "300px",
          backgroundColor: "rgba(0, 0, 0, 0.8)",
          color: "white",
          padding: "16px",
          zIndex: 10,
          overflowY: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <img
            src={logo}
            alt="Logo"
            style={{ width: "40px", height: "40px", cursor: "pointer" }}
            onClick={() => navigate("/")}
          />
          <button
            onClick={() => navigate("/nav-view")}
            style={{
              padding: "10px 16px",
              backgroundColor: "#1e40af",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Nav View
          </button>
        </div>
  
        <h2 style={{ marginBottom: "16px", fontSize: "1.25rem", fontWeight: "bold" }}>
          Nearest Routes
        </h2>
        <ul style={{ paddingLeft: "0", listStyle: "none" }}>
          {nearestRoutes
            .sort((a, b) => {
              if (selectedRoute === a) return -1;
              if (selectedRoute === b) return 1;
              return 0;
            })
            .slice(0, 7)
            .map((route, index) => (
              <li
                key={index}
                onClick={() => handleRouteSelection(route)}
                style={{
                  cursor: "pointer",
                  marginBottom: "5px",
                  backgroundColor: getRouteColor(route.properties.type),
                  color: "black",
                  padding: "14px",
                  borderRadius: "8px",
                  fontWeight: "bold",
                  border:
                    selectedRoute === route
                      ? "2px solid white"
                      : "2px solid transparent",
                }}
              >
                <div style={{ fontSize: "1.1rem" }}>{route.properties.name}</div>
                <div
                  style={{
                    fontSize: "1rem",
                    fontWeight: "semi-bold",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginTop: "4px",
                  }}
                >
                  <span>{formatDistance(route.distance)}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <span className="material-icons" style={{ fontSize: "24px" }}>
                      directions_walk
                    </span>
                    {formatWalkingTime(route.distance)}
                  </span>
                </div>
              </li>
            ))}
        </ul>
        <button
          onClick={handleResetSelection}
          style={{
            padding: "10px 16px",
            backgroundColor: "rgba(0, 0, 0, 0)",
            color: "#f44336",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            marginTop: "5  px",
            fontWeight: "bold",
            fontFamily: "Montserrat"
          }}
        >
          Reset
        </button>

      </div>
  
      {/* Map container */}
      <div
        ref={mapContainerRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
        }}
      />
  
      {/* Marker overlay */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "calc(50% + 150px)",
          width: "24px",
          height: "24px",
          backgroundColor: "#ff0000",
          borderRadius: "50% 50% 50% 0",
          transformOrigin: "bottom center",
          rotate: "-45deg",
          zIndex: 20,
          boxShadow: "0 0 5px rgba(0,0,0,0.5)",
        }}
      />
    </div>
  );

};

export default MapView;
