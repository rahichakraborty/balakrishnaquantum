/*
===========================================
BKQ Market Intelligence
Version 1.1
Author: BKQ
===========================================
*/

async function loadMarketData() {

    try {

        const response = await fetch("./data/market.json");

        if (!response.ok) {
            throw new Error("Unable to load market.json");
        }

        const data = await response.json();

        /* -------------------------
           General
        --------------------------*/

        setText("lastUpdated", data.updated);

        setText("overallBias", data.overallBias);

        setText("confidence", data.confidence + "%");

        setText("tradePlan", data.tradePlan);

        setText("riskLevel", data.risk);

        setText("conviction", data.conviction + "%");

        const convictionBar = document.getElementById("convictionBar");

        if (convictionBar) {
            convictionBar.style.width = data.conviction + "%";
        }

        /* -------------------------
           BTC
        --------------------------*/

        setText("btcBias", data.btc.bias);

        setText("btcConfidence", data.btc.confidence + "%");

        setText("btcSupport", data.btc.support);

        setText("btcResistance", data.btc.resistance);

        setText("btcTrade", data.btc.trade);

        /* -------------------------
           ETH
        --------------------------*/

        setText("ethBias", data.eth.bias);

        setText("ethConfidence", data.eth.confidence + "%");

        setText("ethSupport", data.eth.support);

        setText("ethResistance", data.eth.resistance);

        setText("ethTrade", data.eth.trade);

        /* -------------------------
           Scores
        --------------------------*/

        setScore("macroScore", data.scores.macro);

        setScore("flowScore", data.scores.flows);

        setScore("technicalScore", data.scores.technical);

        setScore("riskScore", data.scores.risk);

        console.log("✅ BKQ Market Intelligence Loaded");

    }

    catch (error) {

        console.error(error);

        alert("Unable to load market data.");

    }

}

/* =======================================
   Helpers
======================================= */

function setText(id, value) {

    const el = document.getElementById(id);

    if (el) {

        el.innerHTML = value;

    }

}

function setScore(id, value) {

    const el = document.getElementById(id);

    if (el) {

        el.innerHTML = value + "%";

    }

}

document.addEventListener("DOMContentLoaded", loadMarketData);
