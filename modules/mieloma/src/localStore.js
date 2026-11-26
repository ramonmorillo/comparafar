// Almacenamiento local POR USUARIO. Antes había una sola clave por navegador: al cambiar de usuario en el mismo equipo
// el siguiente veía (y heredaba) los datos locales del anterior, incluidas condiciones comerciales y acuerdos.
//  · KEY            → modo sin conexión (y datos anteriores a este cambio).
//  · KEY:u:<uid>    → datos de cada usuario con sesión.
//  · KEY:claim      → quién adoptó los datos anteriores (solo el primero que inicia sesión; el resto empieza limpio).
export const KEY = "mielofarma:v1";
export const keyFor = (uid) => KEY + ":u:" + uid;
const CLAIM = KEY + ":claim";

export function makeStore(getStorage, { normalize, fresh }) {
  const st = () => { try { return getStorage(); } catch (e) { return null; } };
  const read = (k) => { try { const raw = st().getItem(k); if (!raw) return null; const o = JSON.parse(raw); return o && o.v === 1 ? o : null; } catch (e) { return null; } };
  const write = (k, v) => { try { st().setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  const drop = (k) => { try { st().removeItem(k); } catch (e) {} };
  return {
    keyFor,
    // Estado de un usuario al iniciar sesión. `local`: estado en memoria si venía del modo sin conexión (se conserva su
    // catálogo y esquemas para que se fusionen con la nube en vez de perderse).
    enter(uid, local) {
      let s = read(keyFor(uid));
      if (!s) {
        let claim = null; try { claim = st().getItem(CLAIM); } catch (e) {}
        if (!claim) {
          try { st().setItem(CLAIM, uid); } catch (e) {}
          const legacy = read(KEY);
          if (legacy) { s = legacy; drop(KEY); }
        }
      }
      let out = s ? normalize(s) : fresh();
      if (local) out = { ...out, catalog: local.catalog, userSchemes: local.userSchemes };
      write(keyFor(uid), out);
      return out;
    },
    // Cierre de sesión: se guarda el estado del usuario (sin esperar al retardo) y la memoria queda limpia.
    leave(uid, S) { if (uid && S) write(keyFor(uid), S); return fresh(); },
    save(key, S) { return write(key, S); },
    clear(key) { drop(key); },
    read,
  };
}
