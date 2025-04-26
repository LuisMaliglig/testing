import React, { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { awsConfig } from "../config/config";
import transitRoute from "../data/transit-lines.json";
import { useNavigate } from "react-router-dom";
import logo from "../assets/logo.png";


const Home = () => {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
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
        paint: {
          "line-color": "#facc15",
          "line-width": 4,
        },
      });

      map.addLayer({
        id: "lrt-line",
        type: "line",
        source: "transit-route",
        filter: ["==", ["get", "type"], "LRT"],
        paint: {
          "line-color": "#22c55e",
          "line-width": 4,
        },
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
        paint: {
          "line-color": "#FFA500",
          "line-width": 3,
        },
      });
    });

    return () => map.remove();
  }, []);

  return (
    <div style={{ position: "relative", height: "100vh" }}>
      {/* Fullscreen blur layer with centered overlay */}
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        backdropFilter: "blur(4px)",
        backgroundColor: "rgba(0, 0, 0, 0.2)", // optional: extra darkening
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}>
        <div style={{
          textAlign: "center",
          color: "white",
          backgroundColor: "rgba(0, 0, 0, 0.4)",
          padding: "24px",
          borderRadius: "12px"
        }}>
          <img
            src={logo}
            alt="Logo"
            style={{
              width: "200px",
              height: "200px",
              objectFit: "cover",
              marginBottom: "16px"
            }}
          />
          <h1 style={{ fontSize: "2rem", fontWeight: "bold", marginBottom: "24px" }}>Street Smart</h1>
          <div style={{ display: "flex", gap: "12px" }}> {/* Flexbox for side by side buttons */}
            <button
              onClick={() => navigate("/map-view")}
              style={{
                width: "150px", // Set width
                height: "80px", // Set height
                backgroundColor: "#1e40af",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                fontSize: "1rem", // Adjust font size for better button text fit
              }}
            >
              Map View
            </button>
            <button
              onClick={() => navigate("/nav-view")}
              style={{
                width: "150px", // Set width
                height: "80px", // Set height
                backgroundColor: "#1e40af",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                fontSize: "1rem", // Adjust font size for better button text fit
              }}
            >
              Navigator
            </button>
          </div>
        </div>
      </div>
  
      {/* Fullscreen map container */}
      <div
        ref={mapContainerRef}
        style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}
      />
    </div>
  );
  
  
};

export default Home;
