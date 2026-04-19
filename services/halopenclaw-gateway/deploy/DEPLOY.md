# Halopenclaw Gateway — Deploy

Target host: the RankEmpire VPS that already runs the HAL stack.
Adjust paths if the production tree differs.

## Initial install

```bash
# As a privileged user on the VPS
sudo useradd -m -d /opt/halofire -s /bin/bash halofire
sudo mkdir -p /opt/halofire/halofire-studio
sudo chown -R halofire:halofire /opt/halofire

# Deploy the tree (via rsync, git clone, or CI)
sudo -u halofire git clone \
    https://github.com/dallasteele/halofire-studio.git \
    /opt/halofire/halofire-studio

cd /opt/halofire/halofire-studio/services/halopenclaw-gateway
sudo -u halofire python3.12 -m venv .venv
sudo -u halofire .venv/bin/pip install -r requirements.txt
sudo -u halofire cp .env.example .env
# Edit .env and fill in ANTHROPIC_API_KEY if not using OAuth

# CubiCasa5k weights (one-time):
sudo mkdir -p /opt/halofire/models
sudo wget -O /opt/halofire/models/model_best_val_loss_var.pkl \
    https://github.com/CubiCasa/CubiCasa5k/releases/download/0.1/model_best_val_loss_var.pkl
sudo chown -R halofire:halofire /opt/halofire/models

# Systemd service
sudo cp deploy/halopenclaw.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now halopenclaw.service
sudo systemctl status halopenclaw.service
```

## Nginx

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/snippets/halopenclaw.conf
# Include in your rankempire.io server block:
#   include /etc/nginx/snippets/halopenclaw.conf;
sudo nginx -t && sudo systemctl reload nginx
```

## Smoke test

```bash
# Local on the VPS
curl http://127.0.0.1:18790/health

# Through nginx
curl https://gateway.rankempire.io/halofire/health
```

Expected:

```json
{"ok":true,"service":"halopenclaw-gateway","version":"0.0.1",
 "tools":["halofire_validate","halofire_ingest","halofire_place_head",
          "halofire_route_pipe","halofire_calc","halofire_export"]}
```

## Updating

```bash
sudo -u halofire bash -c '
  cd /opt/halofire/halofire-studio &&
  git pull &&
  cd services/halopenclaw-gateway &&
  .venv/bin/pip install -r requirements.txt
'
sudo systemctl restart halopenclaw.service
```

## Logs

```bash
sudo journalctl -u halopenclaw.service -f
```

## Rollback

```bash
# Pin to a known-good commit
sudo -u halofire bash -c '
  cd /opt/halofire/halofire-studio &&
  git checkout <commit-sha>
'
sudo systemctl restart halopenclaw.service
```
