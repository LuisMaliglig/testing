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
  const markerRef = useRef(null);
  const [nearestRoutes, setNearestRoutes] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: `https://maps.geo.${awsConfig.region}.amazonaws.com/maps/v0/maps/${awsConfig.mapName}/style-descriptor?key=${awsConfig.apiKey}`,
      center: [121.0357, 14.4981],
      zoom: 11,
    });

    mapRef.current = map;

    map.on("load", () => {
      map.addSource("transit-route", {
        type: "geojson",
        data: transitRoute,
      });

      map.addLayer({
        id: "mrt-line",
        type: "line",
        source: "transit-route",
        filter: ["==", ["get", "type"], "MRT"],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#facc15", "line-width": 4 },
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

      markerRef.current = new maplibregl.Marker({ color: "#ff0000" })
        .setLngLat(map.getCenter())
        .addTo(map);

      map.on("moveend", () => {
        const center = map.getCenter();
        markerRef.current.setLngLat(center);
        updateNearestRoutes(center);
      });
    });

    return () => map.remove();
  }, []);

  const calculateDistance = (point1, point2) => {
    const R = 6371;
    const dLat = ((point2[1] - point1[1]) * Math.PI) / 180;
    const dLon = ((point2[0] - point1[0]) * Math.PI) / 180;
    const lat1 = (point1[1] * Math.PI) / 180;
    const lat2 = (point2[1] * Math.PI) / 180;

    const a = Math.sin(dLat / 2) ** 2 +
              Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const calculateNearestStopDistance = (coordinates, center) => {
    if (!coordinates || coordinates.length === 0) return Infinity;

    return coordinates.reduce((minDist, coord) => {
      const dist = calculateDistance([center.lng, center.lat], coord);
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

      const dist = calculateDistance([center.lng, center.lat], [xx, yy]);
      if (dist < minDistance) minDistance = dist;
    }

    return minDistance;
  };

  const updateNearestRoutes = (center) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const features = map.querySourceFeatures("transit-route");

    const seen = new Map();
    const filtered = features.filter((f) => {
      const id = f.properties.name;
      if (!seen.has(id)) {
        seen.set(id, true);
        return true;
      }
      return false;
    });

    const routesWithDistance = filtered.map((feature) => {
      const coords = feature.geometry.coordinates;
      let distance = 0;

      if (feature.properties.type === "Jeep") {
        distance = calculateRouteLineDistance(coords, center);
      } else {
        distance = calculateNearestStopDistance(coords, center);
      }

      return { properties: feature.properties, geometry: feature.geometry, distance };
    });

    const sorted = routesWithDistance.sort((a, b) => a.distance - b.distance);
    setNearestRoutes(sorted.slice(0, 3));
  };

  const handleRouteSelection = (route) => {
    setSelectedRoute(route);
  };

  return (
    <div style={{ position: "relative", height: "100vh" }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          height: "100%",
          width: "300px",
          backgroundColor: "rgba(0, 0, 0, 0.4)",
          color: "white",
          padding: "16px",
          zIndex: 10,
          borderRadius: "16px",
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
              backgroundColor: "#511F8E",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Nav View
          </button>
        </div>

        <h2 style={{ marginBottom: "16px" }}>Nearest Routes</h2>
        <ul style={{ paddingLeft: "0", listStyle: "none" }}>
          {nearestRoutes.map((route, index) => (
            <li
              key={index}
              onClick={() => handleRouteSelection(route)}
              style={{
                cursor: "pointer",
                marginBottom: "8px",
                backgroundColor:
                  selectedRoute === route ? "#1e40af" : "transparent",
                padding: "8px",
                borderRadius: "6px",
              }}
            >
              {route.properties.name} - {route.distance.toFixed(2)} km
            </li>
          ))}
        </ul>
      </div>
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
    </div>
  );
};

export default MapView;
