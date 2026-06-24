import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
// Semi 2.100 的 exports 未暴露 css 子路径，直接按文件路径引入
import "../node_modules/@douyinfe/semi-ui/dist/css/semi.min.css";
import "./styles.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
