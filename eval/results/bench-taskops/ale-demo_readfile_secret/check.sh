#!/bin/bash
cd /home/jimmy/repos/agents-last-exam
grep '^OPENROUTER_API_KEY=' ~/API_KEYS > secret/.env 2>/dev/null
./taskops_verify.sh smoke_readfile.yaml demo/readfile_secret 1.0