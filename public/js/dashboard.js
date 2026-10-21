const icons = {
            backend: "🖥️", node: "🟩", ollama: "🧠", qwen3: "✨",
            ffmpeg: "🎞️", footage: "🎬", output: "📁", tts: "🗣️",
            renderer: "⚙️", mongodb: "🍃"
        };

        function escapeHtml(value) {
            return String(value ?? "").replace(/[&<>"']/g, char => ({
                "&": "&amp;", "<": "&lt;", ">": "&gt;",
                '"': "&quot;", "'": "&#039;"
            })[char]);
        }

        function renderServices(data) {
            const container = document.getElementById("services");

            if (!data || !data.services || typeof data.services !== "object") {
                container.innerHTML = `
          <div class="service">
            <div class="service-name">Invalid API response</div>
            <div class="detail">The API did not return a valid services object. Open Status JSON to inspect the response.</div>
          </div>`;
                document.getElementById("onlineCount").textContent = "0";
                document.getElementById("totalCount").textContent = "0";
                document.getElementById("healthyCount").textContent = "0";
                return;
            }

            const services = Object.entries(data.services);
            if (services.length === 0) {
                container.innerHTML = `<div class="service"><div class="service-name">No services configured</div><div class="detail">The API returned an empty services object.</div></div>`;
                document.getElementById("onlineCount").textContent = "0";
                document.getElementById("totalCount").textContent = "0";
                document.getElementById("healthyCount").textContent = "0";
                return;
            }

            const online = services.filter(([, s]) => s.status === "online").length;
            const healthy = services.filter(([, s]) => s.healthCheck === "passed").length;
            document.getElementById("onlineCount").textContent = online;
            document.getElementById("totalCount").textContent = services.length;
            document.getElementById("healthyCount").textContent = healthy;

            container.replaceChildren();

            for (const [key, service] of services) {
                const isOnline = service.status === "online";
                const statusClass = isOnline ? "online" : service.status === "checking" ? "checking" : "offline";
                const details = [
                    ["Purpose", service.description],
                    ["URL", service.url],
                    ["Version", service.version],
                    ["Model", service.model],
                    ["Path", service.path],
                    ["Message", service.message]
                ].filter(([, value]) => value !== undefined && value !== null && value !== "").slice(0, 3);

                const card = document.createElement("article");
                card.className = "service";
                card.innerHTML = `
          <div class="service-header">
            <div class="service-name">
              <span class="service-icon" aria-hidden="true">${icons[key] || "🔧"}</span>
              <span class="service-name-text" title="${escapeHtml(service.name || key)}">${escapeHtml(service.name || key)}</span>
            </div>
            <span class="badge ${statusClass}">${escapeHtml(String(service.status || "unknown"))}</span>
          </div>
          <div class="details-list">
            ${details.map(([label, value]) => `
              <div class="detail" title="${escapeHtml(value)}">
                <strong>${escapeHtml(label)}</strong>
                <span class="detail-value">${escapeHtml(value)}</span>
              </div>`).join("")}
          </div>
          <div class="service-foot ${isOnline ? "is-online" : ""}">
            <span class="mini-dot"></span>
            <span>${isOnline ? "Service responding" : service.status === "checking" ? "Checking connection" : "Needs attention"}</span>
          </div>`;
                container.appendChild(card);
            }

            document.getElementById("lastCheck").textContent =
                "Updated " + new Date(data.timestamp || Date.now()).toLocaleTimeString() + " · refreshes every 5s";
        }

        let checking = false;

        async function loadStatus() {
            if (checking) return;
            checking = true;

            const button = document.getElementById("refresh");
            const error = document.getElementById("error");
            button.disabled = true;
            error.style.display = "none";

            try {
                const response = await fetch("/api/status", {cache: "no-store"});
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                renderServices(await response.json());
            } catch (err) {
                error.textContent = "Unable to load service status: " + err.message;
                error.style.display = "block";
            } finally {
                checking = false;
                button.disabled = false;
            }
        }
        fetch('/api/status', { cache: 'no-store' })
  .then(async response => {
    console.log('HTTP STATUS:', response.status);
    const data = await response.json();
    console.log('API DATA:', data);
    return data;
  })
  .catch(error => console.error('FETCH ERROR:', error));

        document.getElementById("refresh")?.addEventListener("click", loadStatus);
loadStatus();
setInterval(loadStatus, 5000);
