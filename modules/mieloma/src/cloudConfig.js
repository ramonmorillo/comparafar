// Clave PUBLICABLE de Supabase (diseñada para ir en el navegador; la seguridad la dan RLS y el login).
// NUNCA pongas aquí la service_role / secret key.
export const CLOUD = {
  url: "https://qmwysaducxbkbximwzxn.supabase.co",
  key: "sb_publishable_l1O-QzlS6NleGh5rlgYTow_WgCUt70q",
  // Sincronización de módulos económicos (migraciones 003–006). Aplicadas en producción el 26/11/2026.
  // Si hay que desactivarla (p. ej. un fallo), vuelve a false: los datos locales de cada navegador no se tocan.
  eco: true,
};
