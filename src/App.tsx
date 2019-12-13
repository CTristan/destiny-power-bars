import useInterval from "@use-it/interval";
import { UserInfoCard } from "bungie-api-ts/user";
import throttle from "lodash/throttle";
import React, { useCallback, useEffect, useRef, useState } from "react";

import {
  auth,
  hasManuallyAuthed,
  hasSelectedDestinyMembership,
  hasValidAuth,
  manualStartAuth,
  setSelectedDestinyMembership
} from "./services/bungie-auth";
import ga from "./services/ga";
import { PowerBarsCharacterData } from "./types";

import CharacterDisplay from "./components/CharacterDisplay";
import FetchSpinner from "./components/FetchSpinner";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import LoadingSpinner from "./components/LoadingSpinner";
import { LoginPrompt } from "./components/LoginPrompt";
import MembershipSelect from "./components/MembershipSelect";
import { VendorDisplay } from "./components/VendorDisplay";
import api from "./services/api";
import {
  BungieSystemDisabledError,
  getManifest,
  ManifestData
} from "./services/bungie-api";
import { EVENTS, useEvent } from "./services/events";
import {
  getCharacterData,
  loadCharacterDisplayOrder,
  saveCharacterDisplayOrder
} from "./services/utils";

import "normalize.css";
import "./index.css";

import STYLES from "./App.module.scss";

const CHARACTER_DATA_REFRESH_TIMER = 15000;

export const AppWrapper = ({ children }: { children: JSX.Element }) => {
  return <div className={STYLES.App}>{children}</div>;
};

const doAuth = useRef(
  throttle(
    (
      localSetIsAuthed: (value: boolean) => void,
      localSetAuthError: (value: boolean) => void
    ) => {
      (async () => {
        try {
          const authResult = await auth();
          if (authResult) {
            localSetIsAuthed(true);
            localSetAuthError(false);
          } else {
            localSetIsAuthed(false);
            localSetAuthError(true);
          }
        } catch (e) {
          console.error(e);
          localSetIsAuthed(false);
          localSetAuthError(true);
        }
      })();
    },
    100
  )
);

const doGetManifest = useRef(
  (
    localSetBungieSystemDisabled: (value: boolean) => void,
    localSetBungieServiceUnavailable: (value: boolean) => void,
    localSetManifestData: (value: ManifestData) => void,
    localSetManifestError: (value: boolean) => void
  ) => {
    return throttle(() => {
      (async () => {
        try {
          const manifestResult = await getManifest();
          if (manifestResult.error) {
            console.error(
              `Error fetching manifest:`,
              manifestResult.error.message
            );
            localSetManifestError(true);
            if (manifestResult.error instanceof BungieSystemDisabledError) {
              localSetBungieSystemDisabled(true);
            }
            if (manifestResult.error.message === "503") {
              localSetBungieServiceUnavailable(true);
            }
            return;
          }
          localSetManifestData(manifestResult.manifest);
        } catch (e) {
          console.error(e);
          localSetManifestError(true);
        }
      })();
    }, 500);
  }
);

const doGetCharacterData = useRef(
  throttle(
    (
      isFetchingCharacterData: boolean,
      setCharacterData: (value: PowerBarsCharacterData[]) => void,
      setIsFetchingCharacterData: (value: boolean) => void,
      setBungieSystemDisabled: (value: boolean) => void,
      setBungieServiceUnavailable: (value: boolean) => void
    ) => {
      const updateCharacterData = (newData: PowerBarsCharacterData[]) => {
        const newOverallPower = Math.max(...newData.map(c => c.overallPower));
        const newArtifactPower = Math.max(
          ...newData.map(c => (c.artifactData ? c.artifactData.bonusPower : 0))
        );
        const newTotalPower = newOverallPower + newArtifactPower;
        ga.set({
          dimension1: `${newOverallPower}`,
          dimension2: `${newArtifactPower}`,
          dimension3: `${newTotalPower}`
        });
        setCharacterData(newData);
      };

      (async () => {
        if (!isFetchingCharacterData) {
          try {
            setIsFetchingCharacterData(true);
            await getCharacterData(
              updateCharacterData,
              setIsFetchingCharacterData
            );
          } catch (error) {
            if (error instanceof BungieSystemDisabledError) {
              setBungieSystemDisabled(true);
            }
            if (error.message === "503") {
              setBungieServiceUnavailable(true);
            }
            console.error("Error fetching character data:", error);
          }
        }
      })();
    },
    500
  )
);

const App = () => {
  const [disableManualLogin, setDisableManualLogin] = useState(
    hasManuallyAuthed()
  );
  const [isAuthed, setIsAuthed] = useState(hasValidAuth());
  const [hasAuthError, setAuthError] = useState(false);
  const [hasSelectedMembership, setHasMembership] = useState(
    hasSelectedDestinyMembership()
  );
  const [manifestData, setManifestData] = useState<ManifestData | undefined>(
    undefined
  );
  const [hasManifestError, setManifestError] = useState(false);
  const [isBungieSystemDisabled, setBungieSystemDisabled] = useState(false);
  const [isBungieServiceUnavailable, setBungieServiceUnavailable] = useState(
    false
  );
  const [isFetchingCharacterData, setIsFetchingCharacterData] = useState(false);
  const [characterData, setCharacterData] = useState<
    PowerBarsCharacterData[] | undefined
  >(undefined);

  const [manifestState, setManifestState] = useState("Unknown");
  useEvent(EVENTS.GET_MANIFEST, () => {
    setManifestError(false);
    setManifestState("Checking manifest version");
  });
  useEvent(EVENTS.LOAD_MANIFEST_DATA, () =>
    setManifestState("Loading manifest data")
  );
  useEvent(EVENTS.FETCH_MANIFEST_DATA, () =>
    setManifestState("Fetching manifest data from Bungie")
  );
  useEvent(EVENTS.PARSE_MANIFEST_DATA, () =>
    setManifestState("Processing manifest data")
  );
  useEvent(EVENTS.STORE_MANIFEST_DATA, () =>
    setManifestState("Saving manifest data")
  );
  useEvent(EVENTS.MANIFEST_DATA_READY, () => {
    setManifestError(false);
    setManifestState("Manifest ready");
  });
  useEvent(EVENTS.LOG_OUT, () => {
    setIsAuthed(false);
    setDisableManualLogin(false);
  });

  const hasManifestData = manifestState === "Manifest ready";

  useEffect(() => {
    if (!isAuthed) {
      doAuth.current(setIsAuthed, setAuthError);
    }
  }, [isAuthed, setIsAuthed, setAuthError]);

  useEffect(
    () =>
      doGetManifest.current(
        setBungieSystemDisabled,
        setBungieServiceUnavailable,
        setManifestData,
        setManifestError
      ),
    [
      setBungieSystemDisabled,
      setBungieServiceUnavailable,
      setManifestData,
      setManifestError
    ]
  );

  useEvent(EVENTS.MANIFEST_FETCH_ERROR, () => {
    doGetManifest.current(
      setBungieSystemDisabled,
      setBungieServiceUnavailable,
      setManifestData,
      setManifestError
    );
  });

  useInterval(() => {
    if (isAuthed && hasSelectedMembership && !isFetchingCharacterData) {
      doGetCharacterData.current(
        isFetchingCharacterData,
        setCharacterData,
        setIsFetchingCharacterData,
        setBungieSystemDisabled,
        setBungieServiceUnavailable
      );
    }
  }, CHARACTER_DATA_REFRESH_TIMER);

  useEffect(() => {
    if (!characterData && !isFetchingCharacterData && !isBungieSystemDisabled) {
      doGetCharacterData.current(
        isFetchingCharacterData,
        setCharacterData,
        setIsFetchingCharacterData,
        setBungieSystemDisabled,
        setBungieServiceUnavailable
      );
    }
  }, [characterData, isFetchingCharacterData, isBungieSystemDisabled]);

  const onSelectMembership = useCallback(
    (membership: UserInfoCard) => {
      ga.event({
        category: "Platform",
        action: "Select platform",
        label: `Membership type: ${membership.membershipType}`
      });
      setSelectedDestinyMembership(membership);
      setHasMembership(true);
    },
    [setHasMembership]
  );

  let status: string | JSX.Element = "";
  if (isBungieSystemDisabled) {
    status = (
      <span>
        Bungie API disabled.
        <br />
        Check{" "}
        <a
          href="https://www.bungie.net/en/Help/Article/13125"
          target="_blank"
          rel="noopener noreferrer"
        >
          Bungie's server and update status page
        </a>{" "}
        for more information
      </span>
    );
  } else if (isBungieServiceUnavailable) {
    status = (
      <span>
        Bungie API unavailable.
        <br />
        Check{" "}
        <a
          href="https://www.bungie.net/en/Help/Article/13125"
          target="_blank"
          rel="noopener noreferrer"
        >
          Bungie's server and update status page
        </a>{" "}
        for more information
      </span>
    );
  } else if (hasAuthError) {
    status = (
      <span
        className={STYLES.statusAuthError}
        onClick={() => manualStartAuth()}
      >
        Bungie.net authentication required
      </span>
    );
  } else if (hasManifestError) {
    status = (
      <span>
        Error fetching manifest, <a href="/">refresh page</a> to try again!
      </span>
    );
  } else if (!isAuthed) {
    status = "Authenticating...";
  } else if (!hasSelectedMembership) {
    status = "Waiting for Destiny platform selection...";
  } else if (!hasManifestData) {
    status = manifestState;
  } else if (!characterData || characterData.length === 0) {
    if (isFetchingCharacterData) {
      status = "Fetching character data...";
    } else {
      status = "No character data";
    }
  }

  (window as any).characterData = characterData;

  const getDefaultCharacterDisplayOrder = useCallback(
    () =>
      characterData ? characterData.map(c => c.character.characterId) : [],
    [characterData]
  );

  const isValidCharacterDisplayOrder = useCallback(
    (characterIds: string[]) =>
      characterData &&
      characterData.length === characterIds.length &&
      characterIds.every(id =>
        characterData.some(c => c.character.characterId === id)
      ) &&
      characterData.every(c => characterIds.includes(c.character.characterId)),
    [characterData]
  );

  const [draggingCharacterId, setDraggingCharacterId] = useState<
    string | undefined
  >(undefined);
  const [characterDisplayOrder, setCharacterDisplayOrder] = useState<
    string[] | undefined
  >(loadCharacterDisplayOrder());
  const dropOnCharacterId = useCallback(
    (dropCharacterId: string) => {
      if (!draggingCharacterId || draggingCharacterId === dropCharacterId) {
        return;
      }
      const currentCharacterOrder =
        characterDisplayOrder && characterDisplayOrder.length > 0
          ? characterDisplayOrder
          : getDefaultCharacterDisplayOrder();

      const swappedOrder = currentCharacterOrder.slice();
      swappedOrder.splice(
        currentCharacterOrder.indexOf(draggingCharacterId),
        1,
        dropCharacterId
      );
      swappedOrder.splice(
        currentCharacterOrder.indexOf(dropCharacterId),
        1,
        draggingCharacterId
      );

      saveCharacterDisplayOrder(swappedOrder);
      setCharacterDisplayOrder(swappedOrder);
    },
    [
      draggingCharacterId,
      characterDisplayOrder,
      setCharacterDisplayOrder,
      getDefaultCharacterDisplayOrder
    ]
  );

  let useCharacterOrder = getDefaultCharacterDisplayOrder();
  if (
    characterData &&
    characterData.length > 0 &&
    characterDisplayOrder &&
    characterDisplayOrder.length > 0
  ) {
    // Validate that character IDs in display order match
    if (isValidCharacterDisplayOrder(characterDisplayOrder)) {
      useCharacterOrder = characterDisplayOrder;
    } else {
      setCharacterDisplayOrder(undefined);
    }
  }

  if (isAuthed && characterData && characterData.length > 0) {
    return (
      <div className={STYLES.App}>
        <MembershipSelect api={api} onMembershipSelect={onSelectMembership} />
        <div className={STYLES.charactersContainer}>
          <div className={STYLES.characters}>
            {useCharacterOrder
              .map(characterId =>
                characterData.find(c => c.character.characterId === characterId)
              )
              .map(c => (
                <CharacterDisplay
                  key={c!.character.characterId}
                  data={c!}
                  onDragStart={characterId =>
                    setDraggingCharacterId(characterId)
                  }
                  onDragEnd={() => setDraggingCharacterId(undefined)}
                  onDragDrop={characterId => dropOnCharacterId(characterId)}
                />
              ))}
          </div>
        </div>
        <VendorDisplay manifestData={manifestData} />
        {status ? <LoadingSpinner>{status}</LoadingSpinner> : null}
        {isFetchingCharacterData ? <FetchSpinner /> : null}
        <Footer />
      </div>
    );
  }

  if (hasAuthError && !disableManualLogin) {
    return (
      <div className={STYLES.App}>
        <Header />
        <LoginPrompt />
        <Footer />
      </div>
    );
  }

  return (
    <div className={STYLES.App}>
      <MembershipSelect api={api} onMembershipSelect={onSelectMembership} />
      <LoadingSpinner>{status}</LoadingSpinner>
      <Footer />
    </div>
  );
};

export default App;
