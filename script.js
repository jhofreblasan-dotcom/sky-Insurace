(() => {
  "use strict";

  const trmEndpoint = "https://www.datos.gov.co/resource/32sa-8pi3.json";
  const tiers = [
    { key: "esencial", name: "Esencial", multiplier: 0.78, description: "Cobertura base" },
    { key: "recomendado", name: "Sky Plus", multiplier: 1, description: "Mejor relación valor/protección" },
    { key: "total", name: "Total 360°", multiplier: 1.32, description: "Máximo respaldo sin límites cortos" }
  ];
  const insuranceNames = {
    vida: "Seguro de Vida",
    vehiculo: "Seguro para Vehículo",
    rc: "Responsabilidad Civil"
  };
  const controls = {
    vida: [
      { id: "vida-capital", output: "vida-capital-val", marks: [50000000, 250000000, 500000000] }
    ],
    vehiculo: [
      { id: "veh-valor", output: "veh-valor-val", marks: [15000000, 120000000, 250000000] }
    ],
    rc: [
      { id: "rc-limite", output: "rc-limite-val", marks: [100000000, 1000000000, 2000000000] }
    ]
  };

  const state = {
    type: "vida",
    currency: "COP",
    tier: "recomendado",
    trm: null,
    trmDate: null,
    annualPrices: []
  };
  const formatters = {
    COP: new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0
    }),
    USD: new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }),
    TRM: new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const currencyAmount = (copAmount) => (
    state.currency === "USD" ? copAmount / state.trm : copAmount
  );
  const formatMoney = (copAmount) => {
    if (state.currency === "USD" && !state.trm) return "TRM no disponible";
    return `${formatters[state.currency].format(currencyAmount(copAmount))} ${state.currency}`;
  };
  const formatCompact = (copAmount) => {
    if (state.currency === "USD" && !state.trm) return "—";
    const amount = currencyAmount(copAmount);
    const divisor = amount >= 1000000 ? 1000000 : amount >= 1000 ? 1000 : 1;
    const suffix = divisor === 1000000 ? "M" : divisor === 1000 ? " mil" : "";
    const value = new Intl.NumberFormat(state.currency === "COP" ? "es-CO" : "en-US", {
      maximumFractionDigits: 1
    }).format(amount / divisor);
    return `${state.currency === "COP" ? "$" : "$"}${value}${suffix}`;
  };
  const selectedExtras = (group) => $$(".extra-toggle:checked")
    .filter((input) => input.dataset.group === group)
    .map((input) => input.dataset.key);

  function getCurrentDateBogota() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  async function loadTRM() {
    const label = $("#trm-label");
    const today = getCurrentDateBogota();
    const query = new URLSearchParams({
      "$limit": "1",
      "$order": "vigenciadesde DESC",
      "$where": `vigenciadesde <= '${today}T23:59:59'`
    });
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(`${trmEndpoint}?${query}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`La consulta de TRM respondió con estado ${response.status}.`);
      }

      const records = await response.json();
      const record = records[0];
      const rate = Number(record?.valor);
      if (!record || !Number.isFinite(rate) || rate <= 0 || !record.vigenciadesde) {
        throw new Error("La fuente de TRM no devolvió un valor válido.");
      }

      state.trm = rate;
      state.trmDate = record.vigenciadesde.slice(0, 10);
      label.textContent = `TRM: ${formatters.TRM.format(rate)} COP/USD · ${new Intl.DateTimeFormat("es-CO", {
        timeZone: "UTC",
        day: "2-digit",
        month: "short",
        year: "numeric"
      }).format(new Date(`${state.trmDate}T12:00:00Z`))}`;
    } catch (error) {
      label.textContent = "TRM no disponible; la simulación en COP sigue activa.";
      label.title = error instanceof Error ? error.message : "No se pudo consultar la fuente de TRM.";
    } finally {
      window.clearTimeout(timeout);
      render();
    }
  }

  function readForm() {
    return {
      edad: Number($("#vida-edad").value),
      capital: Number($("#vida-capital").value),
      valorVehiculo: Number($("#veh-valor").value),
      edadConductor: $("#veh-edad").value,
      tipoVehiculo: $("#veh-tipo-group .pill-opt.active")?.dataset.val ?? "auto",
      limiteRC: Number($("#rc-limite").value),
      perfilRC: $("#rc-perfil").value
    };
  }

  function calculateAnnualPrices(form) {
    const tierFactors = tiers.map((tier) => tier.multiplier);

    if (state.type === "vida") {
      const ageFactor = Math.min(2.8, Math.max(0.55, Math.exp((form.edad - 35) * 0.035)));
      const extras = selectedExtras("vida");
      const extraFactor = 1 + extras.reduce((total, key) => total + ({
        graves: 0.22,
        incapacidad: 0.18,
        exequial: 0.08
      }[key] ?? 0), 0);
      return tierFactors.map((factor) => Math.max(
        120000,
        form.capital * 0.0024 * ageFactor * factor * extraFactor
      ));
    }

    if (state.type === "vehiculo") {
      const baseRate = { auto: 0.037, suv: 0.041, moto: 0.052 }[form.tipoVehiculo];
      const driverFactor = { "18-25": 1.28, "26-35": 1, "36-45": 0.94, "46+": 0.9 }[form.edadConductor];
      const extrasRate = selectedExtras("vehiculo").reduce((total, key) => total + ({
        reemplazo: 0.0012,
        vidrios: 0.0008,
        asistencia: 0.0009
      }[key] ?? 0), 0);
      return tierFactors.map((factor) => (
        form.valorVehiculo * (baseRate * factor + extrasRate) * driverFactor
      ));
    }

    const profileRates = {
      hogar: 0.0008,
      rce: 0.0018,
      profesional: 0.0027,
      pyme: 0.0036
    };
    const extraFactor = 1 + selectedExtras("rc").reduce((total, key) => total + ({
      defensa: 0.12,
      moral: 0.18,
      predios: 0.24
    }[key] ?? 0), 0);
    return tierFactors.map((factor) => Math.max(
      180000,
      form.limiteRC * profileRates[form.perfilRC] * factor * extraFactor
    ));
  }

  function getContext(form) {
    if (state.type === "vida") {
      const extraNames = {
        graves: "Enfermedades graves",
        incapacidad: "Incapacidad total y permanente",
        exequial: "Auxilio exequial y hospitalización"
      };
      return {
        details: [
          `Edad: ${form.edad} años`,
          `Capital asegurado: ${formatMoney(form.capital)}`,
          ...selectedExtras("vida").map((key) => extraNames[key])
        ],
        protectionBase: 38
      };
    }

    if (state.type === "vehiculo") {
      const extraNames = {
        reemplazo: "Vehículo de reemplazo",
        vidrios: "Llaves, vidrios y accesorios",
        asistencia: "Conductor elegido y grúa ampliada"
      };
      const vehicleNames = { auto: "Automóvil", suv: "Camioneta / SUV", moto: "Motocicleta" };
      return {
        details: [
          `Vehículo: ${vehicleNames[form.tipoVehiculo]}`,
          `Valor comercial: ${formatMoney(form.valorVehiculo)}`,
          `Edad del conductor: ${form.edadConductor} años`,
          ...selectedExtras("vehiculo").map((key) => extraNames[key])
        ],
        protectionBase: 40
      };
    }

    const profileNames = {
      hogar: "Personal / Familiar / Hogar",
      rce: "RCE Vehicular",
      profesional: "Profesional Independiente",
      pyme: "Pyme / Empresa / Contratista"
    };
    const extraNames = {
      defensa: "Defensa legal y cauciones",
      moral: "Perjuicios extrapatrimoniales",
      predios: "Predios, labores y contratistas"
    };
    return {
      details: [
        `Perfil: ${profileNames[form.perfilRC]}`,
        `Límite de cobertura: ${formatMoney(form.limiteRC)}`,
        ...selectedExtras("rc").map((key) => extraNames[key])
      ],
      protectionBase: 36
    };
  }

  function updateRangeDisplays(form) {
    Object.values(controls).flat().forEach(({ id, output, marks }) => {
      const slider = $(`#${id}`);
      $(`#${output}`).textContent = `${formatMoney(Number(slider.value))}`;
      const labels = slider.parentElement.querySelectorAll(".range-marks span");
      marks.forEach((value, index) => {
        if (labels[index]) labels[index].textContent = formatCompact(value);
      });
    });
    $("#vida-edad-val").textContent = `${form.edad} años`;
  }

  function updateProtection(tierIndex, extrasCount) {
    const score = Math.min(100, [42, 64, 82][tierIndex] + extrasCount * 4);
    const label = score >= 80 ? "Blindaje Alto" : score >= 60 ? "Protección Amplia" : "Protección Base";
    $("#protection-score").textContent = `${score}% — ${label}`;
    $("#protection-bar").style.width = `${score}%`;
  }

  function updateWhatsApp(prices, context, form) {
    const selectedIndex = tiers.findIndex((tier) => tier.key === state.tier);
    const monthlyCOP = prices[selectedIndex] / 12;
    const annualCOP = prices[selectedIndex];
    const unavailable = state.currency === "USD" && !state.trm;
    const selectedTier = tiers[selectedIndex];
    const details = context.details.join("\n• ");
    const message = [
      "Hola Sky Insurance, quiero validar esta simulación de seguro:",
      `• Seguro: ${insuranceNames[state.type]}`,
      `• Propuesta: ${selectedTier.name}`,
      `• Configuración: ${details}`,
      `• Estimado: ${unavailable ? "TRM no disponible para mostrar USD" : `${formatMoney(monthlyCOP)} al mes (${formatMoney(annualCOP)} al año)`}`,
      state.currency === "USD" && state.trm
        ? `• TRM de referencia: ${formatters.TRM.format(state.trm)} COP/USD (${state.trmDate})`
        : "",
      "Entiendo que es un valor orientativo y deseo recibir una cotización formal."
    ].filter(Boolean).join("\n");
    const quoteLink = $("#btn-send-quote-wa");
    quoteLink.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
    quoteLink.setAttribute("aria-disabled", String(unavailable));
    quoteLink.classList.toggle("is-disabled", unavailable);
    quoteLink.title = unavailable
      ? "No se puede incluir un valor USD hasta consultar la TRM. Cambia a COP o intenta de nuevo más tarde."
      : "Abrir WhatsApp con el resumen de esta propuesta";
    quoteLink.dataset.message = message;

    $$(".wa-sync").forEach((link) => {
      const genericMessage = link.dataset.waMsg || "Hola Sky Insurance, deseo recibir asesoría.";
      link.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(genericMessage)}`;
    });
  }

  function render() {
    const form = readForm();
    const prices = calculateAnnualPrices(form);
    const context = getContext(form);
    const selectedIndex = tiers.findIndex((tier) => tier.key === state.tier);
    const unavailable = state.currency === "USD" && !state.trm;

    updateRangeDisplays(form);
    state.annualPrices = prices;

    tiers.forEach((tier, index) => {
      const monthly = prices[index] / 12;
      $(`#price-${tier.key}`).textContent = unavailable ? "TRM N/D" : formatMoney(monthly);
      $(`#sub-${tier.key}`).textContent = unavailable ? "Consulta no disponible" : "/ mes estimado";
      const card = $(`.tier-card[data-tier="${tier.key}"]`);
      card.setAttribute("aria-pressed", String(tier.key === state.tier));
    });

    const selectedTier = tiers[selectedIndex];
    const selectedMonthly = prices[selectedIndex] / 12;
    $("#prop-kicker").textContent = `PROPUESTA INICIAL • ${insuranceNames[state.type].toUpperCase()}`;
    $("#prop-title").textContent = `Plan ${selectedTier.name}${state.tier === "recomendado" ? " (Recomendado)" : ""}`;
    $("#prop-monthly").textContent = unavailable ? "TRM no disponible" : formatMoney(selectedMonthly);
    $("#prop-annual").textContent = unavailable
      ? "Cambia a COP para ver el estimado"
      : `Anual estimado: ${formatMoney(prices[selectedIndex])}`;
    $("#prop-highlights").replaceChildren(...context.details.map((detail) => {
      const item = document.createElement("li");
      item.textContent = detail;
      return item;
    }));
    const extrasCount = selectedExtras(state.type).length;
    updateProtection(selectedIndex, extrasCount);
    updateWhatsApp(prices, context, form);
  }

  function announce(message) {
    const feedback = $("#quote-feedback");
    feedback.textContent = message;
    window.setTimeout(() => {
      if (feedback.textContent === message) feedback.textContent = "";
    }, 3500);
  }

  function copyQuote() {
    const message = $("#btn-send-quote-wa").dataset.message;
    if (!message) {
      announce("No se pudo preparar el resumen. Revisa la configuración e inténtalo de nuevo.");
      return;
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(message)
        .then(() => announce("Resumen copiado al portapapeles."))
        .catch((error) => {
          console.error("No se pudo copiar el resumen:", error);
          announce("No se pudo copiar automáticamente. Selecciona y copia el mensaje desde WhatsApp.");
        });
      return;
    }

    const textArea = document.createElement("textarea");
    textArea.value = message;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.append(textArea);
    textArea.select();
    const copied = document.execCommand("copy");
    textArea.remove();
    announce(copied
      ? "Resumen copiado al portapapeles."
      : "No se pudo copiar automáticamente. Selecciona y copia el mensaje desde WhatsApp.");
  }

  function bindEvents() {
    $$(".q-tab").forEach((tab) => tab.addEventListener("click", () => {
      state.type = tab.dataset.type;
      $$(".q-tab").forEach((item) => {
        const active = item === tab;
        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", String(active));
      });
      $$(".control-group").forEach((group) => {
        group.classList.toggle("active", group.id === `controls-${state.type}`);
      });
      render();
    }));

    $$(".curr-btn").forEach((button) => button.addEventListener("click", () => {
      state.currency = button.dataset.currency;
      $$(".curr-btn").forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      render();
    }));

    $$(".tier-card").forEach((card) => card.addEventListener("click", () => {
      state.tier = card.dataset.tier;
      $$(".tier-card").forEach((item) => item.classList.toggle("active", item === card));
      render();
    }));

    Object.values(controls).flat().forEach(({ id }) => {
      $(`#${id}`).addEventListener("input", render);
    });
    ["vida-edad", "veh-edad", "rc-perfil"].forEach((id) => {
      $(`#${id}`).addEventListener("input", render);
      $(`#${id}`).addEventListener("change", render);
    });
    $$(".extra-toggle").forEach((input) => input.addEventListener("change", render));
    $$("#veh-tipo-group .pill-opt").forEach((button) => button.addEventListener("click", () => {
      $$("#veh-tipo-group .pill-opt").forEach((item) => item.classList.toggle("active", item === button));
      render();
    }));
    $("#btn-copy-quote").addEventListener("click", copyQuote);
    $("#btn-send-quote-wa").addEventListener("click", (event) => {
      if (event.currentTarget.getAttribute("aria-disabled") === "true") {
        event.preventDefault();
        announce("La TRM no está disponible. Cambia a COP o vuelve a intentar más tarde.");
      }
    });
  }

  function init() {
    $$(".q-tab").forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.type === state.type)));
    $$(".curr-btn").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.currency === state.currency)));
    bindEvents();
    render();
    loadTRM();
  }

  init();
})();