#!/usr/bin/env bash
# Kontrola stavu a bezpečnosti monitoring stacku (Grafana + Prometheus).
#
# Skript vznikl po hlášení CESNET (2026-08-26) k hostu cvat2.utia.cas.cz:
#   - Grafana 12.4.2 veřejně na 3030/tcp (10 CVE)
#   - Prometheus bez autentizace na 9090/tcp
#   - pprof debug endpoint na 9090/tcp (CVE-2019-11248)
#
# Root cause: docker-compose.monitoring.yml publikoval porty krátkou syntaxí
# ('9090:9090'), která v Dockeru bindne 0.0.0.0. Publikovaný port se přeloží
# v nat/PREROUTING a paket pak jde řetězcem FORWARD (odkud se volá DOCKER-USER);
# do INPUT se nikdy nedostane, takže pravidla ufw v INPUT ho neuvidí. Firewallem
# by to šlo řešit jen pravidlem v DOCKER-USER — spolehlivější a lokální obrana
# je bind adresa přímo v compose.
#
# NÁVRHOVÉ ZÁSADY (porušení kterékoli z nich je chyba, ne detail):
#   1. Allowlist, ne denylist. Neznámá hodnota musí padat do "selhalo".
#      Denylist ("je to jedna ze známých špatných forem?") pustí všechno ostatní —
#      bind na 147.231.160.153 by prošel jako loopback.
#   2. Žádná sonda nesmí poškodit to, co kontroluje. Ani vypnutím služby
#      (POST /-/quit), ani smazáním dat (delete_series se skutečným matcherem),
#      ani zamčením účtu (přihlášení uniklým heslem).
#   3. "Nešlo ověřit" je selhání, ne úspěch. Prázdná odpověď, chybějící nástroj
#      ani nedostupná služba nesmí nikdy vyrobit zelenou fajfku.
#
# Použití:  ./scripts/monitoring-security-check.sh
# Návratový kód: 0 = vše v pořádku, 1 = alespoň jedna kontrola selhala.
#
# POZOR: nespouštěj opakovaně v rychlém sledu při ladění — sekce "Grafana"
# dělá jedno ÚSPĚŠNÉ přihlášení; to je bezpečné, ale kdybys sem přidal
# neúspěšné, Grafana zamkne účet admin po 5 pokusech (viz komentář tam).
#
# Cron je verzovaný v scripts/monitoring-security-check.cron.

set -uo pipefail
# 'ip' bývá v /usr/sbin, který klasický cron PATH nemá. Bez tohohle by se
# nezjistila veřejná IP a kontrola dosažitelnosti by denně padala.
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

GRAFANA_PORT=3030
PROM_PORT=9090
# 12.4.4 = první BĚŽNÝ patch obsahující opravy z 12.4.3+security-02.
# Prosté 12.4.3 je starší než ten security release, takže je stále zranitelné —
# proto floor NENÍ 12.4.3, i když CVE zavírá "12.4.3+security-02".
GRAFANA_MIN_SAFE="12.4.4"
EXPECTED_TARGETS=6                   # scrape targety v monitoring/production-prometheus.yml
# SHA-256 hesla, které uniklo ve veřejném repozitáři (přidáno mimochodem
# v nesouvisejícím commitu 6f1f0275). Záměrně jen hash, ne plaintext: vložit
# uniklé heslo zpátky do repa kvůli kontrole na uniklá hesla je absurdní a
# GitGuardian to správně hlásí jako nález. Skenování plaintextu napříč
# soubory dělá GitGuardian v CI — tady stačí porovnat, že nakonfigurované
# heslo není zrovna tohle.
LEAKED_PASSWORD_SHA256='76d7c5c53ee649aa6ada0392cc8557acd904319d968837d428ace9ed01719398'

pass=0; fail=0
# Barvy jen na terminálu — v cron logu by ANSI sekvence byly nečitelný šum.
if [ -t 1 ]; then C_OK=$'\033[32m'; C_BAD=$'\033[31m'; C_WARN=$'\033[33m'; C_B=$'\033[1m'; C_0=$'\033[0m'
else C_OK=''; C_BAD=''; C_WARN=''; C_B=''; C_0=''; fi
ok()    { printf '  %s✓%s %s\n' "$C_OK"   "$C_0" "$1"; pass=$((pass+1)); }
bad()   { printf '  %s✗%s %s\n' "$C_BAD"  "$C_0" "$1"; fail=$((fail+1)); }
warn()  { printf '  %s!%s %s\n' "$C_WARN" "$C_0" "$1"; }
head_() { printf '\n%s%s%s\n' "$C_B" "$1" "$C_0"; }

repo_root=$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null)
COMPOSE="${repo_root:-}/docker-compose.monitoring.yml"

# Hodnota z .env se čte stejně, jako ji čte docker compose: bez 'export',
# s odstraněnými obalujícími uvozovkami. Jinak by správné heslo v uvozovkách
# vyrobilo falešnou červenou s matoucí diagnózou ".env a Grafana se rozešly".
read_env() {
  [ -n "$repo_root" ] && [ -r "$repo_root/.env" ] || return 1
  sed -n "s/^$1=//p" "$repo_root/.env" | head -1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}
GF_PASS=$(read_env GRAFANA_ADMIN_PASSWORD || true)

# Přihlašovací údaje jdou curlu na STDIN (-K -), takže se neobjeví v `ps`
# ani nezůstanou v /tmp, když skript někdo přeruší uprostřed běhu.
gf_auth_curl() {
  printf 'user = "admin:%s"\n' "${GF_PASS//\\/\\\\}" \
    | curl --noproxy '*' -s -m 10 -K - "$@" 2>/dev/null
}

head_ "1. Compose: deklarace portů (chytí revert PŘED nasazením)"
if [ ! -r "$COMPOSE" ]; then
  bad "$COMPOSE nelze přečíst — statická kontrola NEPROBĚHLA"
else
  # Autoritativní zdroj je rozgenerovaný config, ne grep přes YAML: zachytí
  # i mapovou formu a interpolaci proměnných.
  cfg=$(cd "$repo_root" && docker compose -f "$COMPOSE" config --format json 2>/dev/null)
  if [ -z "$cfg" ]; then
    bad "docker compose config selhal — statická kontrola NEPROBĚHLA"
  else
    verdict=$(python3 -c '
import json,sys
try:
    svcs=json.load(sys.stdin).get("services",{})
except Exception as e:
    print("ERR|"+str(e)); raise SystemExit
offend=[]
for name,svc in svcs.items():
    for port in (svc.get("ports") or []):
        hip=port.get("host_ip","")
        if hip not in ("127.0.0.1","::1"):
            offend.append(name+":"+str(port.get("published"))+"@"+(hip or "VSECHNA"))
print("BAD|"+",".join(offend) if offend else "OK|")
' <<<"$cfg")
    case "$verdict" in
      OK\|*)  ok "všechny publikované porty jsou deklarované na loopbacku" ;;
      BAD\|*) bad "compose publikuje mimo loopback: ${verdict#BAD|}" ;;
      *)      bad "nelze vyhodnotit compose config (${verdict#ERR|})" ;;
    esac
  fi
  # Heslo natvrdo. Musí chytit i mapovou formu (klíč: hodnota) a fallback
  # ${VAR:-heslo}, kterým se ':?' ochrana nejsnáz obchází při spěšném deployi.
  if grep -qE 'GF_SECURITY_ADMIN_PASSWORD[=:][[:space:]]*([^$[:space:]]|\$\{[A-Za-z_][A-Za-z0-9_]*:-)' "$COMPOSE"; then
    bad "docker-compose.monitoring.yml má heslo natvrdo nebo jako :- fallback"
  else
    ok "heslo Grafany se čte výhradně z env proměnné"
  fi
  if grep -qE 'image:[[:space:]]*(grafana/grafana|prom/prometheus):latest' "$COMPOSE"; then
    bad "grafana nebo prometheus běží na plovoucím :latest"
  else
    ok "image grafany i promethea jsou pinnuté"
  fi
fi

head_ "2. Skutečná vazba portů (allowlist — cokoli mimo loopback je chyba)"
for port in "$GRAFANA_PORT" "$PROM_PORT"; do
  binds=$(ss -tln 2>/dev/null | awk -v p=":$port" '$4 ~ p"$" {print $4}')
  if [ -z "$binds" ]; then
    bad "port $port vůbec nenaslouchá — služba běží?"
  elif grep -qvE '^(127\.[0-9]+\.[0-9]+\.[0-9]+|\[::1\]):' <<<"$binds"; then
    bad "port $port NENÍ jen na loopbacku: $(tr '\n' ' ' <<<"$binds")"
  else
    ok "port $port jen na loopbacku: $(tr '\n' ' ' <<<"$binds")"
  fi
done

head_ "3. Nedostupnost přes veřejnou IP"
# Pozor na rozsah: sonda jde z hostu na jeho vlastní adresu, tedy přes
# nat/OUTPUT, ne přes cestu zvenčí. Dokazuje, že port není publikovaný —
# NEDOKAZUJE, co vidí internet (to závisí i na firewallu ÚTIA).
PUBLIC_IP=$(ip -4 -o addr show scope global 2>/dev/null \
            | awk '{print $4}' | cut -d/ -f1 \
            | grep -Ev '^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|169\.254\.)' | head -1)
if [ -z "$PUBLIC_IP" ]; then
  bad "nepodařilo se zjistit veřejnou IP — dostupnost NEOVĚŘENA"
else
  for port in "$GRAFANA_PORT" "$PROM_PORT"; do
    # --noproxy: proxy proměnná v prostředí by vrátila 000 (= "žádná odpověď")
    # i pro port, který reálně serveruje internetu. Ověřeno experimentálně.
    curl --noproxy '*' -s -m 5 -o /dev/null "http://${PUBLIC_IP}:${port}/" 2>/dev/null
    rv=$?
    # Jen exit 7 = spojení odmítnuto. 28 (timeout), 6 (DNS) a spol. znamenají
    # "nevím", což u bezpečnostní kontroly nesmí být zelená.
    case "$rv" in
      7) ok "${PUBLIC_IP}:${port} odmítá spojení" ;;
      0) bad "${PUBLIC_IP}:${port} ODPOVÍDÁ — stále veřejné!" ;;
      *) bad "${PUBLIC_IP}:${port} nelze ověřit (curl exit ${rv}) — NEZNÁMÝ stav" ;;
    esac
  done
fi

head_ "4. nginx neobchází loopback"
# Loopback bind NENÍ hranice vůči nginxu: ten je na stejné docker síti a na
# grafanu dosáhne přímo. Jediný proxy_pass by ji zveřejnil na 443, aniž by
# kterákoli kontrola výše zčervenala. V repu leží vypnutý config, který to
# přesně dělá (docker/nginx/sites/staging.spherosegapp.conf.disabled).
if [ -z "$repo_root" ]; then
  bad "repo_root nezjištěn — kontrola nginx konfigurace NEPROBĚHLA"
elif grep -rqIE 'proxy_pass[^;]*(grafana|prometheus|:3030|:9090)' \
      "$repo_root/docker/nginx/sites-enabled/" "$repo_root/docker/nginx/nginx.production.conf" 2>/dev/null; then
  bad "aktivní nginx config proxuje na monitoring — obchází loopback bind"
else
  ok "žádný aktivní nginx config neproxuje na grafanu ani prometheus"
fi

head_ "5. Prometheus: debug a admin endpointy"
pprof=$(curl --noproxy '*' -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PROM_PORT}/debug/pprof/" 2>/dev/null)
case "$pprof" in
  200) warn "pprof na loopbacku dostupný — zvenčí nedosažitelný, přijatelné" ;;
  404|403) ok "pprof vypnutý (HTTP ${pprof})" ;;
  *)   bad "pprof nelze ověřit (HTTP ${pprof:-žádná odpověď}) — Prometheus běží?" ;;
esac
# Sonda musí být /-/reload, NE /-/quit: obojí hlídá stejný --web.enable-lifecycle,
# ale kdyby byl flag zapnutý, POST /-/quit by Prometheus rovnou vypnul. GET
# nestačí — Prometheus vrací 405 (špatná metoda) bez ohledu na to, zda je API
# povolené, takže by kontrola procházela ze špatného důvodu.
life=$(curl --noproxy '*' -s -m 5 -X POST "http://127.0.0.1:${PROM_PORT}/-/reload" 2>/dev/null)
if grep -q 'Lifecycle API is not enabled' <<<"$life"; then
  ok "lifecycle API vypnuté — Prometheus nelze vzdáleně vypnout"
else
  bad "lifecycle API NENÍ prokazatelně vypnuté (odpověď: ${life:0:60})"
fi
# Matcher musí být série, která NEEXISTUJE. S 'match[]=up' by tahle sonda
# na běhu, kdy problém detekuje, smazala 30 dní historie dostupnosti všech
# targetů — tedy přesně data potřebná k vyšetření, jak se admin API zapnulo.
# Odpověď na vypnuté cestě je pro oba matchery bajtově shodná.
admin=$(curl --noproxy '*' -s -m 5 -X POST \
  "http://127.0.0.1:${PROM_PORT}/api/v1/admin/tsdb/delete_series?match%5B%5D=__security_check_probe_neexistuje" 2>/dev/null)
if grep -q 'admin APIs disabled' <<<"$admin"; then
  ok "admin API vypnuté (nelze mazat metriky)"
else
  bad "admin API NENÍ prokazatelně vypnuté (odpověď: ${admin:0:60})"
fi

head_ "6. Grafana: verze a přihlašovací údaje"
version=$(curl --noproxy '*' -s -m 5 "http://127.0.0.1:${GRAFANA_PORT}/api/health" 2>/dev/null \
          | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
  # 'unknown' nebo prázdno nesmí projít jako "dost nová" — to by z CVE brány
  # udělalo no-op, který svítí zeleně.
  bad "verzi Grafany nelze určit (${version:-žádná odpověď}) — CVE brána NEOVĚŘENA"
else
  lowest=$(printf '%s\n%s\n' "$version" "$GRAFANA_MIN_SAFE" | sort -V | head -1)
  if [ "$version" != "$GRAFANA_MIN_SAFE" ] && [ "$lowest" = "$version" ]; then
    bad "Grafana ${version} < ${GRAFANA_MIN_SAFE} — zranitelná (CVE z hlášení CESNET)"
  else
    ok "Grafana ${version} ≥ ${GRAFANA_MIN_SAFE}"
  fi
fi
# Uniklé heslo se NIKDY nezkouší přes API. Grafana zamyká účet po 5 neúspěšných
# pokusech během 5 minut a počítá je podle JMÉNA
# (brute_force_login_protection_max_attempts = 5; okno je napevno v kódu).
# Při ladění se skript spouští opakovaně za sebou, takže i jediný neúspěšný
# pokus na běh admina spolehlivě zamkne — pozorováno při vývoji.
# Ekvivalentní důkaz bez jediného neúspěšného přihlášení:
#   (a) nakonfigurované heslo se nerovná uniklému (porovnání řetězců),
#   (b) tímto heslem se lze přihlásit => Grafana má právě tohle heslo.
# Rozsah: platí pro účet admin. Neříká nic o dalších uživatelích nebo service
# accountech, které mohly vzniknout, dokud byla instance veřejná — proto níže
# zvlášť kontrolujeme jejich počet.
if [ -z "$GF_PASS" ]; then
  bad "GRAFANA_ADMIN_PASSWORD nelze přečíst z .env — údaje NEOVĚŘENY"
elif [ "$(printf '%s' "$GF_PASS" | sha256sum | cut -d' ' -f1)" = "$LEAKED_PASSWORD_SHA256" ]; then
  bad "nakonfigurované heslo JE to uniklé z veřejného repa — nutná rotace"
else
  code=$(gf_auth_curl -o /dev/null -w '%{http_code}' "http://127.0.0.1:${GRAFANA_PORT}/api/org")
  if [ "$code" = "200" ]; then
    ok "heslo z .env se liší od uniklého a přihlásí se => Grafana uniklé heslo nemá"
  else
    bad "heslo z .env se NEPŘIHLÁSÍ (HTTP ${code:-žádná odpověď}) — .env a Grafana se rozešly"
  fi
fi
anon=$(curl --noproxy '*' -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${GRAFANA_PORT}/api/org" 2>/dev/null)
[ "$anon" = "401" ] \
  && ok "anonymní přístup odmítnut (HTTP 401)" \
  || bad "anonymní přístup vrací HTTP ${anon:-žádná odpověď} — očekáváno 401"
# Rotace hesla neruší účty ani tokeny založené v době, kdy byla Grafana veřejná.
if [ -n "$GF_PASS" ]; then
  extra=$(gf_auth_curl "http://127.0.0.1:${GRAFANA_PORT}/api/org/users" \
          | python3 -c 'import json,sys
try: u=json.load(sys.stdin)
except Exception: print("ERR"); raise SystemExit
print(",".join(sorted(x["login"] for x in u)) if isinstance(u,list) else "ERR")' 2>/dev/null)
  sa=$(gf_auth_curl "http://127.0.0.1:${GRAFANA_PORT}/api/serviceaccounts/search" \
       | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("totalCount","ERR"))
except Exception: print("ERR")' 2>/dev/null)
  if [ "$extra" = "admin" ] && [ "$sa" = "0" ]; then
    ok "žádný účet ani service account navíc (jen admin)"
  else
    bad "neočekávané účty/service accounty: uživatelé=[${extra}] service_accounts=[${sa}]"
  fi
fi

head_ "7. Tajemství"
# Skenování souborů na uniklý plaintext tady ZÁMĚRNĚ není: dělá to GitGuardian
# v CI, obecněji a bez nutnosti mít to heslo v repu. Že uniklá hodnota není
# v compose, pokrývá silněji kontrola v sekci 1 (žádný literál, ani :- fallback).
# Uniklé heslo navíc zůstává natrvalo v historii veřejného repa (commit
# 6f1f0275) — proti tomu chrání jedině rotace, kterou ověřuje sekce 6.
if [ -z "$repo_root" ]; then
  bad "repo_root nezjištěn — práva .env NEOVĚŘENA"
elif [ -r "$repo_root/.env" ]; then
  mode=$(stat -c %a "$repo_root/.env" 2>/dev/null)
  [ "$mode" = "600" ] \
    && ok ".env má práva 600" \
    || bad ".env má práva ${mode:-?} — heslo je čitelné pro ostatní účty na hostu"
else
  bad ".env nelze přečíst — práva NEOVĚŘENA"
fi

head_ "8. Zdraví monitoringu"
targets=$(curl --noproxy '*' -s -m 8 "http://127.0.0.1:${PROM_PORT}/api/v1/targets?state=any" 2>/dev/null)
tstat=$(python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: print("ERR|0|0"); raise SystemExit
if d.get("status")!="success": print("ERR|0|0"); raise SystemExit
t=d["data"]["activeTargets"]
print(f"OK|{len(t)}|{sum(1 for x in t if x.get(chr(104)+chr(101)+chr(97)+chr(108)+chr(116)+chr(104))!=chr(117)+chr(112))}")' <<<"$targets" 2>/dev/null)
tot=$(cut -d'|' -f2 <<<"$tstat"); dn=$(cut -d'|' -f3 <<<"$tstat")
if [ "${tstat%%|*}" != "OK" ]; then
  bad "Prometheus nevrátil platný seznam targetů — zdraví NEOVĚŘENO"
elif [ "${tot:-0}" -lt "$EXPECTED_TARGETS" ]; then
  # Bez téhle podmínky by prázdný seznam hlásil "všech 0 targetů je up".
  bad "jen ${tot} scrape targetů (očekáváno ≥${EXPECTED_TARGETS}) — job zmizel z konfigurace?"
elif [ "${dn:-1}" -ne 0 ]; then
  bad "${dn} z ${tot} targetů není up"
else
  ok "všech ${tot} scrape targetů je up"
fi
ds=$(curl --noproxy '*' -s -m 8 "http://127.0.0.1:${GRAFANA_PORT}/api/health" 2>/dev/null \
     | sed -n 's/.*"database"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
[ "$ds" = "ok" ] && ok "databáze Grafany ok" || bad "databáze Grafany: ${ds:-neodpovídá}"

head_ "9. Stav alertů"
if [ -z "$GF_PASS" ]; then
  bad "GRAFANA_ADMIN_PASSWORD nelze přečíst — stav alertů NEOVĚŘEN"
else
  rules=$(gf_auth_curl "http://127.0.0.1:${GRAFANA_PORT}/api/prometheus/grafana/api/v1/rules")
  summary=$(python3 -c '
import json,sys
try: groups=json.load(sys.stdin)["data"]["groups"]
except Exception: print("ERR"); raise SystemExit
firing=[r["name"] for g in groups for r in g.get("rules",[]) if r.get("state")=="firing"]
total=sum(len(g.get("rules",[])) for g in groups)
print(f"{len(firing)}|{total}|{chr(44).join(firing)}")' <<<"$rules" 2>/dev/null)
  if [ "$summary" = "ERR" ] || [ -z "$summary" ]; then
    bad "nepodařilo se přečíst stav alertů z Grafany"
  else
    nfire=${summary%%|*}; rest=${summary#*|}; ntot=${rest%%|*}; names=${rest#*|}
    if [ "${ntot:-0}" -eq 0 ]; then
      # Rozbité provisioning alertů by jinak hlásilo "žádný z 0 alertů nehoří".
      bad "Grafana nemá ŽÁDNÁ alert pravidla — rozbité provisioning?"
    elif [ "$nfire" -eq 0 ]; then
      ok "žádný ze ${ntot} alertů nehoří"
    else
      bad "HOŘÍ ${nfire} z ${ntot} alertů: ${names}"
    fi
  fi
fi

head_ "Výsledek"
printf '  prošlo: %d, selhalo: %d\n\n' "$pass" "$fail"
# Stavový soubor: jediné `cat` řekne, jak dopadl poslední běh, aniž by se
# musel číst celý log.
printf '%s exit=%d pass=%d fail=%d\n' "$(date -Is)" "$([ "$fail" -eq 0 ] && echo 0 || echo 1)" "$pass" "$fail" \
  > "${HOME:-/tmp}/.monitoring-check-status" 2>/dev/null || true
[ "$fail" -eq 0 ]
