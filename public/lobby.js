(() => {
  const GAME_PATH = window.location.protocol === "file:"
    ? "http://127.0.0.1:8080/games/zha-jin-hua.html"
    : "/games/zha-jin-hua.html";
  const ROOM_ID_PATTERN = /^[A-Z0-9]{1,8}$/;
  const gameCatalog = Object.freeze([
    { id: "zha-jin-hua", status: "available", href: GAME_PATH + "?setup=1" },
    { id: "party-cards", status: "coming-soon" },
    { id: "undercover", status: "coming-soon" },
    { id: "werewolf", status: "coming-soon" },
  ]);

  const quickJoinForm = document.querySelector("[data-quick-join]");
  const roomCodeInput = document.querySelector("#roomCode");
  const joinButton = document.querySelector("[data-join-button]");
  const joinError = document.querySelector("#joinError");
  const menuButton = document.querySelector("[data-menu-toggle]");
  const mainNav = document.querySelector("#mainNav");
  const heroImage = document.querySelector("[data-hero-image]");
  const heroFrame = document.querySelector("[data-hero-frame]");
  const resumeTitle = document.querySelector("[data-resume-title]");
  const resumeCopy = document.querySelector("[data-resume-copy]");
  const resumeRoom = document.querySelector("[data-resume-room]");
  const resumeAction = document.querySelector("[data-resume-action]");
  const headerResume = document.querySelector("[data-header-resume]");

  renderCatalogState();
  renderResumeState();
  bindNavigation();
  bindEntryActions();
  bindImageFallback();

  function renderCatalogState() {
    gameCatalog.forEach((game) => {
      const card = document.querySelector('[data-game-id="' + game.id + '"]');
      if (!card) return;
      card.dataset.status = game.status;
      if (game.status === "available" && game.href && card instanceof HTMLAnchorElement) {
        card.href = game.href;
      }
    });
  }

  function renderResumeState() {
    const session = readStoredSession();
    if (!session?.roomId) return;

    const safeRoomId = normalizeRoomId(session.roomId);
    if (!safeRoomId) return;

    if (resumeTitle) resumeTitle.textContent = "上一桌还在等你";
    if (resumeCopy) resumeCopy.textContent = "回到刚才的朋友局，连接成功后会自动恢复座位。";
    if (resumeRoom) {
      resumeRoom.hidden = false;
      resumeRoom.textContent = "房间 " + safeRoomId;
    }
    if (resumeAction) {
      resumeAction.href = GAME_PATH;
      resumeAction.textContent = "继续上一桌";
    }
    if (headerResume) {
      headerResume.hidden = false;
      headerResume.href = GAME_PATH;
    }
  }

  function bindNavigation() {
    if (!menuButton || !mainNav) return;

    menuButton.addEventListener("click", () => {
      const open = mainNav.dataset.open !== "true";
      mainNav.dataset.open = String(open);
      menuButton.setAttribute("aria-expanded", String(open));
      menuButton.setAttribute("aria-label", open ? "关闭导航" : "打开导航");
    });

    mainNav.addEventListener("click", () => closeMenu());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu({ restoreFocus: true });
    });
    document.addEventListener("click", (event) => {
      if (mainNav.dataset.open !== "true") return;
      if (mainNav.contains(event.target) || menuButton.contains(event.target)) return;
      closeMenu();
    });
  }

  function closeMenu(options = {}) {
    if (!menuButton || !mainNav || mainNav.dataset.open !== "true") return;
    mainNav.dataset.open = "false";
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "打开导航");
    if (options.restoreFocus) menuButton.focus();
  }

  function bindEntryActions() {
    document.querySelectorAll("[data-start-game]").forEach((link) => {
      link.href = GAME_PATH + "?setup=1";
      link.addEventListener("click", () => {
        link.setAttribute("aria-busy", "true");
      });
    });

    if (!quickJoinForm || !roomCodeInput || !joinButton || !joinError) return;

    roomCodeInput.addEventListener("input", () => {
      roomCodeInput.value = normalizeRoomId(roomCodeInput.value);
      clearJoinError();
    });

    quickJoinForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const roomId = normalizeRoomId(roomCodeInput.value);
      roomCodeInput.value = roomId;

      if (!roomId) {
        showJoinError("请输入房间号");
        return;
      }
      if (!ROOM_ID_PATTERN.test(roomId)) {
        showJoinError("房间号只能包含字母和数字");
        return;
      }

      quickJoinForm.dataset.state = "loading";
      joinButton.disabled = true;
      joinButton.textContent = "正在进入";
      window.location.assign(GAME_PATH + "?room=" + encodeURIComponent(roomId));
    });
  }

  function bindImageFallback() {
    if (!heroImage || !heroFrame) return;
    const showFallback = () => {
      heroFrame.dataset.artFailed = "true";
    };
    if (heroImage.complete && heroImage.naturalWidth === 0) {
      showFallback();
      return;
    }
    heroImage.addEventListener("error", showFallback, { once: true });
  }

  function showJoinError(message) {
    if (!quickJoinForm || !joinError || !roomCodeInput) return;
    quickJoinForm.dataset.state = "error";
    joinError.textContent = message;
    roomCodeInput.setAttribute("aria-invalid", "true");
    roomCodeInput.focus();
  }

  function clearJoinError() {
    if (!quickJoinForm || !joinError || !roomCodeInput) return;
    quickJoinForm.dataset.state = "idle";
    joinError.textContent = "";
    roomCodeInput.removeAttribute("aria-invalid");
  }

  function readStoredSession() {
    try {
      return JSON.parse(localStorage.getItem("lastRoomSession") || "null");
    } catch {
      return null;
    }
  }

  function normalizeRoomId(value) {
    return String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 8);
  }
})();
