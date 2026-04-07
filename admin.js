const adminWorkspace = document.getElementById("adminWorkspace");
const adminLoginForm = document.getElementById("adminLoginForm");
const adminUsernameInput = document.getElementById("adminUsernameInput");
const adminPasswordInput = document.getElementById("adminPasswordInput");
const adminLoginStatus = document.getElementById("adminLoginStatus");
const adminLogoutButton = document.getElementById("adminLogoutButton");
const reportSelector = document.getElementById("reportSelector");
const reportUpdateForm = document.getElementById("reportUpdateForm");
const reportStatusInput = document.getElementById("reportStatusInput");
const downloadLabelInput = document.getElementById("downloadLabelInput");
const collectedOnInput = document.getElementById("collectedOnInput");
const doctorNoteInput = document.getElementById("doctorNoteInput");
const reportItemsInput = document.getElementById("reportItemsInput");
const reportPdfInput = document.getElementById("reportPdfInput");
const canDownloadInput = document.getElementById("canDownloadInput");
const adminFormStatus = document.getElementById("adminFormStatus");
const adminReportList = document.getElementById("adminReportList");
const adminAppointmentList = document.getElementById("adminAppointmentList");
const metricAppointments = document.getElementById("metricAppointments");
const metricReports = document.getElementById("metricReports");
const metricReadyReports = document.getElementById("metricReadyReports");
const metricPendingReports = document.getElementById("metricPendingReports");
const navToggle = document.querySelector(".nav-toggle");
const topbar = document.querySelector(".topbar");
const adminNav = document.getElementById("adminNav");
const themeToggle = document.getElementById("themeToggle");

let reports = [];

window.addEventListener("DOMContentLoaded", async () => {
  initializeThemeToggle();
  setupMobileNav();
  await checkAdminSession();
});

function initializeThemeToggle() {
  if (!themeToggle) {
    return;
  }

  const savedTheme = localStorage.getItem("pathlab-theme");
  const preferredTheme = savedTheme || "light";
  applyTheme(preferredTheme);

  themeToggle.addEventListener("click", () => {
    const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    localStorage.setItem("pathlab-theme", nextTheme);
  });
}

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.body.dataset.theme = isDark ? "dark" : "light";

  if (!themeToggle) {
    return;
  }

  themeToggle.setAttribute("aria-pressed", String(isDark));
  themeToggle.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
  themeToggle.querySelector(".theme-toggle-icon").textContent = isDark ? "L" : "D";
  themeToggle.querySelector(".theme-toggle-label").textContent = isDark ? "Light Mode" : "Dark Mode";
}

function setupMobileNav() {
  if (!navToggle || !topbar || !adminNav) {
    return;
  }

  const closeMenu = () => {
    topbar.classList.remove("menu-open");
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "Open navigation menu");
  };

  navToggle.addEventListener("click", () => {
    const willOpen = !topbar.classList.contains("menu-open");
    topbar.classList.toggle("menu-open", willOpen);
    navToggle.setAttribute("aria-expanded", String(willOpen));
    navToggle.setAttribute("aria-label", willOpen ? "Close navigation menu" : "Open navigation menu");
  });

  adminNav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      if (window.innerWidth <= 640) {
        closeMenu();
      }
    });
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 640) {
      closeMenu();
    }
  });
}

adminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  adminLoginStatus.textContent = "Signing in...";

  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: adminUsernameInput.value.trim(),
        password: adminPasswordInput.value
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Unable to login");
    }

    adminLoginStatus.textContent = `Signed in as ${result.username}.`;
    adminWorkspace.classList.remove("hidden");
    await loadAdminData();
  } catch (error) {
    adminLoginStatus.textContent = error.message || "Unable to login.";
  }
});

adminLogoutButton.addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  adminWorkspace.classList.add("hidden");
  reports = [];
  adminLoginStatus.textContent = "Logged out. Login required to view admin data.";
});

reportSelector.addEventListener("change", () => {
  const selectedReport = reports.find((report) => report.reportId === reportSelector.value);
  fillReportForm(selectedReport);
});

reportUpdateForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const reportId = reportSelector.value;
  if (!reportId) {
    adminFormStatus.textContent = "Select a report before saving.";
    return;
  }

  adminFormStatus.textContent = "Saving report update...";

  try {
    const reportFile = await readSelectedPdfFile();
    const response = await fetch(`/api/admin/reports/${reportId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        status: reportStatusInput.value,
        downloadLabel: downloadLabelInput.value.trim(),
        collectedOn: collectedOnInput.value.trim(),
        doctorNote: doctorNoteInput.value.trim(),
        reportItems: reportItemsInput.value.trim(),
        canDownload: canDownloadInput.checked,
        reportFile
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Unable to save report update");
    }

    adminFormStatus.textContent = `Saved ${result.reportId} successfully.`;
    reportPdfInput.value = "";
    await loadAdminData(result.reportId);
  } catch (error) {
    adminFormStatus.textContent = error.message || "Unable to save report update.";
  }
});

async function checkAdminSession() {
  try {
    const response = await fetch("/api/admin/me");

    if (response.status === 401) {
      adminWorkspace.classList.add("hidden");
      return;
    }

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Unable to verify admin session");
    }

    adminLoginStatus.textContent = `Signed in as ${result.username}.`;
    adminWorkspace.classList.remove("hidden");
    await loadAdminData();
  } catch (error) {
    adminWorkspace.classList.add("hidden");
  }
}

async function loadAdminData(preferredReportId) {
  try {
    const [overviewResponse, reportsResponse, appointmentsResponse] = await Promise.all([
      fetch("/api/admin/overview"),
      fetch("/api/admin/reports"),
      fetch("/api/admin/appointments")
    ]);

    const overview = await overviewResponse.json();
    reports = await reportsResponse.json();
    const appointments = await appointmentsResponse.json();

    metricAppointments.textContent = overview.totalAppointments;
    metricReports.textContent = overview.totalReports;
    metricReadyReports.textContent = overview.readyReports;
    metricPendingReports.textContent = overview.pendingReports;
    adminWorkspace.classList.remove("hidden");

    renderReportSelector(preferredReportId);
    renderAdminReportList(reports);
    renderAdminAppointmentList(appointments);
  } catch (error) {
    adminFormStatus.textContent = "Unable to load admin data.";
  }
}

function renderReportSelector(preferredReportId) {
  if (!reports.length) {
    reportSelector.innerHTML = `<option value="">No reports found</option>`;
    fillReportForm(null);
    return;
  }

  reportSelector.innerHTML = reports.map((report) => `
    <option value="${report.reportId}">${report.reportId} · ${report.patient} · ${report.packageName}</option>
  `).join("");

  const selectedId = preferredReportId || reports[0].reportId;
  reportSelector.value = selectedId;
  fillReportForm(reports.find((report) => report.reportId === selectedId));
}

function fillReportForm(report) {
  if (!report) {
    reportStatusInput.value = "Appointment booked";
    downloadLabelInput.value = "Download report";
    collectedOnInput.value = "";
    doctorNoteInput.value = "";
    reportItemsInput.value = "";
    canDownloadInput.checked = false;
    return;
  }

  reportStatusInput.value = report.status;
  downloadLabelInput.value = report.downloadLabel || "Download report";
  collectedOnInput.value = report.collectedOn;
  doctorNoteInput.value = report.doctorNote;
  reportItemsInput.value = report.reportItems.join("\n");
  canDownloadInput.checked = report.canDownload;
}

function renderAdminReportList(reportEntries) {
  if (!reportEntries.length) {
    adminReportList.innerHTML = `<p class="report-placeholder">No reports available.</p>`;
    return;
  }

  adminReportList.innerHTML = reportEntries.map((report) => `
    <article class="data-item">
      <div class="data-item-header">
        <strong>${report.reportId}</strong>
        <span class="report-badge ${report.badgeClass}">${report.status}</span>
      </div>
      <p>${report.patient} · ${report.packageName}</p>
      <p>Updated: ${report.updatedOn}</p>
      <p>${report.canDownload ? "Download enabled" : "Waiting for release"}</p>
      <p>${report.hasPdf ? `PDF attached: ${report.reportFileName}` : "No PDF uploaded yet"}</p>
    </article>
  `).join("");
}

function renderAdminAppointmentList(appointments) {
  if (!appointments.length) {
    adminAppointmentList.innerHTML = `<p class="report-placeholder">No appointments available.</p>`;
    return;
  }

  adminAppointmentList.innerHTML = appointments.map((appointment) => `
    <article class="data-item">
      <div class="data-item-header">
        <strong>${appointment.patientName}</strong>
        <span class="report-badge processing">${appointment.status}</span>
      </div>
      <p>${appointment.packageName} · ${appointment.appointmentDate} · ${appointment.timeSlot}</p>
      <p>${appointment.city} · ${appointment.phoneNumber}</p>
      <p>Booking ID <code>${appointment.bookingId}</code> · Report ID <code>${appointment.reportId}</code></p>
    </article>
  `).join("");
}

async function readSelectedPdfFile() {
  const file = reportPdfInput.files[0];

  if (!file) {
    return null;
  }

  if (file.type !== "application/pdf") {
    throw new Error("Only PDF files can be uploaded");
  }

  const dataBase64 = await fileToBase64(file);
  return {
    name: file.name,
    contentType: file.type,
    dataBase64
  };
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.split(",")[1] || "");
    };

    reader.onerror = () => reject(new Error("Unable to read PDF file"));
    reader.readAsDataURL(file);
  });
}
