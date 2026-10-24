/* PymeGuía — motor de cálculo determinista.
 *
 * La IA solo recoge datos crudos (precios, unidades, costos con su moneda, % de comisiones,
 * gastos fijos). Todas las cuentas se hacen aquí, con el mismo resultado siempre.
 *
 * Convención de redondeo: cada línea del desglose se redondea a céntimos y el costo total es
 * la suma de esas líneas ya redondeadas (lo que ve el usuario siempre suma).
 *
 * Funciona en el navegador (window.PymeEngine) y en Node (module.exports).
 */
(function (root) {
  'use strict';

  var round2 = function (x) { return Math.round(x * 100 + (x >= 0 ? 1e-9 : -1e-9)) / 100; };

  // Acepta 25.76, "25.76", "25,76", "1.234,56", "€25,76"; devuelve NaN si no es un número.
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (typeof v !== 'string') return NaN;
    var s = v.replace(/[^\d.,-]/g, '');
    if (!s) return NaN;
    var lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (lastComma > -1) {
      s = s.replace(',', '.');
    }
    var n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }

  // Un valor opcional: vacío o ausente => def; presente pero ilegible => NaN (se reporta).
  function optNum(v, def) {
    if (v === undefined || v === null || v === '') return def;
    return num(v);
  }

  var SYMBOL_TO_ISO = { '€': 'EUR', 'eur': 'EUR', 'euro': 'EUR', 'euros': 'EUR', 'us$': 'USD', 'usd': 'USD', 'u$s': 'USD', 'dólar': 'USD', 'dólares': 'USD', 'dolar': 'USD', 'dolares': 'USD', '£': 'GBP', 'gbp': 'GBP' };
  function isoOf(m) {
    if (m === undefined || m === null) return '';
    var s = String(m).trim();
    if (!s) return '';
    var k = s.toLowerCase();
    return SYMBOL_TO_ISO[k] || s.toUpperCase();
  }

  // Resuelve la dependencia circular de costos que son % del precio (impuestos, comisiones):
  //   P = costosNoPct / (1 - sumaPct - margen)
  // Si la suma de % y margen deja el denominador casi en cero, cae a costoTotal / (1 - margen).
  var PCT_RE = /(\d+(?:[.,]\d+)?)\s*%/;
  function calcPrecioRec(desgloseItems, costoTotal, margenPct) {
    var margenDec = margenPct / 100;
    var totalPct = 0, costosFijos = 0;
    (desgloseItems || []).forEach(function (item) {
      var m = item.concepto.match(PCT_RE);
      if (m) totalPct += parseFloat(m[1].replace(',', '.')) / 100;
      else costosFijos += item.valor;
    });
    var den = 1 - totalPct - margenDec;
    if (totalPct > 0 && den > 0.05) {
      var prec = round2(costosFijos / den);
      var costoReal = round2(costosFijos + totalPct * prec);
      return { prec: prec, costoReal: costoReal };
    }
    var p = round2(costoTotal / (1 - margenDec));
    return { prec: p, costoReal: costoTotal };
  }

  // Los nombres de líneas que NO son porcentajes no pueden contener "%" (la app los confundiría).
  function cleanName(s, fallback) {
    var t = String(s == null ? '' : s).replace(/\s*%\s*/g, ' ').replace(/\s+/g, ' ').trim();
    return t || fallback;
  }

  function isRaw(parsed) {
    return !!parsed && typeof parsed === 'object' &&
      (parsed.version === 2 || (Array.isArray(parsed.productos) && parsed.productos.some(function (p) {
        return p && (Array.isArray(p.costos_unit) || p.precio !== undefined) && p.desglose === undefined;
      })));
  }

  /**
   * compute(raw) -> { ok, errors[], warnings[], data, resumen }
   *  data: objeto con la forma que ya consumen showResults / buildResultCardHTML (modo single|multi)
   *  resumen: datos estructurados para la pantalla "Confirma tus datos"
   */
  function compute(raw) {
    var errors = [], warnings = [];
    var out = { ok: false, errors: errors, warnings: warnings, data: null, resumen: null };
    if (!raw || typeof raw !== 'object') { errors.push('No llegaron datos.'); return out; }

    var simbolo = raw.moneda ? String(raw.moneda) : '€';
    var baseIso = isoOf(raw.moneda_codigo) || isoOf(simbolo);
    var isBase = function (m) {
      var iso = isoOf(m);
      return !iso || iso === baseIso || iso === isoOf(simbolo) || String(m).trim() === simbolo;
    };

    // Tipos de cambio: { "USD": 0.92 } = 1 USD vale 0,92 de la moneda base
    var rates = {};
    var usedRates = {};
    var tc = raw.tipo_cambio && typeof raw.tipo_cambio === 'object' ? raw.tipo_cambio : {};
    Object.keys(tc).forEach(function (k) {
      var r = num(tc[k]);
      if (r > 0) rates[isoOf(k)] = r;
    });
    function toBase(monto, moneda, label) {
      if (isBase(moneda)) return monto;
      var iso = isoOf(moneda);
      var r = rates[iso];
      if (!(r > 0)) {
        errors.push('Falta el tipo de cambio de ' + iso + ' a ' + simbolo + ' (necesario para "' + label + '").');
        return NaN;
      }
      usedRates[iso] = r;
      return monto * r;
    }

    // ── Productos ──
    var productosRaw = Array.isArray(raw.productos) ? raw.productos : [];
    if (!productosRaw.length) errors.push('No hay productos en el análisis.');
    var productos = productosRaw.map(function (p, idx) {
      p = p || {};
      var nombre = cleanName(p.producto || p.nombre, 'Producto ' + (idx + 1));
      var precio = num(p.precio !== undefined ? p.precio : p.precio_actual);
      var unidades = num(p.unidades_mes);
      if (!(precio > 0)) errors.push('Falta el precio de venta de "' + nombre + '".');
      if (!(unidades > 0)) errors.push('Faltan las unidades por mes de "' + nombre + '".');
      return { raw: p, nombre: nombre, precio: precio, unidades: unidades };
    });
    var unidadesTotal = productos.reduce(function (s, p) { return s + (p.unidades > 0 ? p.unidades : 0); }, 0);

    // ── Gastos fijos mensuales (se reparten entre las unidades de TODOS los productos) ──
    var fijos = [];
    (Array.isArray(raw.fijos_mensuales) ? raw.fijos_mensuales : []).forEach(function (f) {
      if (!f) return;
      var concepto = cleanName(f.concepto, 'Gasto fijo');
      var monto = num(f.monto);
      if (!(monto >= 0)) { errors.push('No se entiende el monto del gasto fijo "' + concepto + '".'); return; }
      var cada = optNum(f.cada_meses, 1);
      if (!(cada > 0)) { errors.push('No se entiende cada cuántos meses se paga "' + concepto + '".'); return; }
      var montoBase = toBase(monto, f.moneda, concepto);
      if (!isFinite(montoBase)) return;
      var mensual = montoBase / cada;
      if (mensual > 0) fijos.push({ concepto: concepto, monto: monto, moneda: isBase(f.moneda) ? '' : isoOf(f.moneda), cada_meses: cada, mensual: round2(mensual), mensualExacto: mensual });
    });
    var fijosTotalExacto = fijos.reduce(function (s, f) { return s + f.mensualExacto; }, 0);
    var fijoUnitExacto = unidadesTotal > 0 ? fijosTotalExacto / unidadesTotal : 0;

    // ── Costo por producto ──
    var pctGlobal = Array.isArray(raw.costos_pct) ? raw.costos_pct : [];
    var resumenProductos = [];
    var dataProductos = productos.map(function (p) {
      var desglose = [];
      var itemsResumen = [];
      var pr = p.raw;

      (Array.isArray(pr.costos_unit) ? pr.costos_unit : []).forEach(function (c) {
        if (!c) return;
        var concepto = cleanName(c.concepto, 'Costo');
        var monto = num(c.monto);
        if (!(monto >= 0)) { errors.push('No se entiende el costo "' + concepto + '" de ' + p.nombre + '.'); return; }
        var cantidad = optNum(c.cantidad, 1);
        var rinde = optNum(c.rinde, 1);
        if (!(cantidad >= 0) || !(rinde > 0)) { errors.push('Cantidad o rendimiento inválido en "' + concepto + '" de ' + p.nombre + '.'); return; }
        var montoBase = toBase(monto, c.moneda, concepto);
        if (!isFinite(montoBase)) return;
        var valor = round2(montoBase * cantidad / rinde);
        itemsResumen.push({ concepto: concepto, monto: monto, moneda: isBase(c.moneda) ? '' : isoOf(c.moneda), cantidad: cantidad, rinde: rinde, valor: valor });
        if (valor > 0) desglose.push({ concepto: concepto, valor: valor });
      });

      var fijoUnit = round2(fijoUnitExacto);
      if (fijoUnit > 0) {
        desglose.push({ concepto: 'Gastos fijos (' + simbolo + fmt2(fijosTotalExacto) + '/mes ÷ ' + fmtUds(unidadesTotal) + ' uds)', valor: fijoUnit });
      }

      var tiempo = optNum(pr.tiempo_horas, 0);
      var valorHora = optNum(pr.valor_hora, 0);
      if (!(tiempo >= 0)) { errors.push('No se entiende el tiempo por unidad de ' + p.nombre + '.'); tiempo = 0; }
      if (!(valorHora >= 0)) { errors.push('No se entiende el valor hora de ' + p.nombre + '.'); valorHora = 0; }
      var mano = 0;
      if (tiempo > 0 && valorHora > 0) {
        mano = round2(tiempo * valorHora);
        if (mano > 0) desglose.push({ concepto: 'Mano de obra (' + fmtH(tiempo) + ' h × ' + simbolo + fmt2(valorHora) + '/h)', valor: mano });
      }

      var pctItems = [];
      var pctList = pctGlobal.concat(Array.isArray(pr.costos_pct) ? pr.costos_pct : []);
      pctList.forEach(function (c) {
        if (!c) return;
        var concepto = cleanName(c.concepto, 'Comisión');
        var pct = num(c.pct);
        if (!(pct >= 0)) { errors.push('No se entiende el porcentaje de "' + concepto + '".'); return; }
        if (pct >= 100) { errors.push('El porcentaje de "' + concepto + '" es mayor o igual a 100.'); return; }
        if (!(p.precio > 0) || pct === 0) return;
        var label = concepto + ' ' + String(pct).replace('.', ',') + '%';
        var valor = round2(pct / 100 * p.precio);
        pctItems.push({ concepto: concepto, pct: pct, valor: valor });
        desglose.push({ concepto: label, valor: valor });
      });

      var costoTotal = round2(desglose.reduce(function (s, r) { return s + r.valor; }, 0));
      var sumPct = pctItems.reduce(function (s, r) { return s + r.pct; }, 0);
      var margen = optNum(raw.margen_elegido, 30);
      if (sumPct + margen >= 95) warnings.push('En "' + p.nombre + '" las comisiones (' + sumPct + '%) y el margen (' + margen + '%) suman casi todo el precio: el precio recomendado no es fiable.');

      var rec = calcPrecioRec(desglose, costoTotal, margen);
      var min = calcPrecioRec(desglose, costoTotal, 0);
      var gan = round2(p.precio - costoTotal);

      var costoDirecto = round2(itemsResumen.reduce(function (s, r) { return s + r.valor; }, 0) + mano);
      var costoVariable = round2(pctItems.reduce(function (s, r) { return s + r.valor; }, 0));

      resumenProductos.push({
        producto: p.nombre, precio: p.precio, unidades: p.unidades, items: itemsResumen,
        pct: pctItems, tiempo_horas: tiempo, valor_hora: valorHora, manoDeObra: mano
      });

      return {
        producto: p.nombre, precio_actual: p.precio, unidades_mes: p.unidades,
        costo_directo: costoDirecto, costo_fijo_unit: fijoUnit, costo_variable: costoVariable,
        costo_total: costoTotal, precio_minimo: min.prec, precio_recomendado: rec.prec,
        margen_actual_pct: p.precio > 0 ? round2((gan / p.precio) * 100) : 0,
        ganancia_unidad: gan, tiempo_horas: tiempo, valor_hora: valorHora, desglose: desglose
      };
    });

    if (errors.length) return out;

    var base = {
      negocio: cleanName(raw.negocio, 'Tu negocio'),
      moneda: simbolo,
      margen_elegido: optNum(raw.margen_elegido, 30),
      valor_hora_mercado_bajo: optNum(raw.valor_hora_mercado_bajo, 0),
      valor_hora_mercado_medio: optNum(raw.valor_hora_mercado_medio, 0),
      valor_hora_mercado_alto: optNum(raw.valor_hora_mercado_alto, 0),
      rubro_referencia: raw.rubro_referencia || '',
      consejo_cualitativo: raw.consejo_cualitativo || '',
      problema_detectado: raw.problema_detectado || ''
    };

    var data;
    var ganMes = round2(dataProductos.reduce(function (s, p) { return s + round2(p.ganancia_unidad * p.unidades_mes); }, 0));
    if (dataProductos.length === 1) {
      var p0 = dataProductos[0];
      data = Object.assign({ modo: 'single' }, base, p0, {
        ganancia_mensual: ganMes, ganancia_anual: round2(ganMes * 12)
      });
      delete data.ganancia_unidad;
    } else {
      data = Object.assign({ modo: 'multi' }, base, {
        productos: dataProductos,
        consolidado: {
          ganancia_mensual: ganMes, ganancia_anual: round2(ganMes * 12),
          unidades_mes_total: unidadesTotal, costo_fijo_mensual_total: round2(fijosTotalExacto)
        }
      });
    }
    data._engine = true;

    out.ok = true;
    out.data = data;
    out.resumen = {
      moneda: simbolo,
      margen: base.margen_elegido,
      fijos: fijos.map(function (f) { return { concepto: f.concepto, monto: f.monto, moneda: f.moneda, cada_meses: f.cada_meses, mensual: f.mensual }; }),
      fijosTotal: round2(fijosTotalExacto),
      unidadesTotal: unidadesTotal,
      fijoUnit: round2(fijoUnitExacto),
      tipoCambio: Object.keys(usedRates).map(function (k) { return { moneda: k, tasa: usedRates[k] }; }),
      productos: resumenProductos
    };
    return out;
  }

  function fmt2(n) { return Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtUds(n) { return Number(n).toLocaleString('es-ES', { maximumFractionDigits: 2 }); }
  function fmtH(n) { return Number(n).toLocaleString('es-ES', { maximumFractionDigits: 2 }); }

  var api = { compute: compute, calcPrecioRec: calcPrecioRec, isRaw: isRaw, round2: round2, num: num };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PymeEngine = api;
})(typeof window !== 'undefined' ? window : this);
