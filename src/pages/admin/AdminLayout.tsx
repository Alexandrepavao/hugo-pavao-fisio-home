import { Outlet } from "react-router-dom";
import AppShell from "@/components/hp/AppShell";

/** Layout único da área de gestão (sidebar persistente e recolhível, header compacto, drawer no mobile). */
const AdminLayout = () => (
  <AppShell><Outlet /></AppShell>
);

export default AdminLayout;
