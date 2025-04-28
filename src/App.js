import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import Home from "./pages/Home";
import MapView from "./pages/MapView";
import NavView from "./pages/NavView";
import RouteBreakdown from "./pages/RouteBreakdown";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/home" element={<Home />} />
        <Route path="/map-view" element={<MapView />} />
        <Route path="/nav-view" element={<NavView />} />
        <Route path="/route-breakdown" element={<RouteBreakdown />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </Router>
  );
}

export default App;