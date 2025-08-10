const socket = io();
socket.on("welcome", (msg) => console.log(msg));
socket.on("chat", (msg) => {
  const li = document.createElement("li");
  li.textContent = msg;
  document.getElementById("messages").appendChild(li);
});
document.getElementById("send").onclick = () => {
  const msg = document.getElementById("msg").value;
  socket.emit("chat", msg);
  document.getElementById("msg").value = "";
};
