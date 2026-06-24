import { Routes, Route, Navigate } from "react-router-dom";
import TemplatesHome from "./pages/TemplatesHome.jsx";
import TemplateSkus from "./pages/TemplateSkus.jsx";
import TemplateSettings from "./pages/TemplateSettings.jsx";
import SkuWorkbench from "./pages/SkuWorkbench.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<TemplatesHome />} />
      <Route path="/templates/:templateId" element={<TemplateSkus />} />
      <Route path="/templates/:templateId/settings" element={<TemplateSettings />} />
      <Route path="/skus/:skuId" element={<SkuWorkbench />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
